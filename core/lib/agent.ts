import {
  IMemory,
  IProvider,
  ITool,
  ReasoningProfile,
  MessageRole,
  IAgentConfig,
  TraceSource,
  Attachment,
  InsightCategory,
  ToolCall,
} from './types/index';
import { logger } from './logger';
import { SYSTEM, AGENT_ERRORS, CONFIG_KEYS, OPTIMIZATION_POLICIES } from './constants';
import { ConfigManager } from './registry/config';
import { AgentProcessOptions } from './agent/options';
import { AgentEmitter } from './agent/emitter';
import { parseConfigInt } from './providers/utils';
import { DEFAULT_SIGNAL_SCHEMA } from './agent/schema';
import { normalizeBaseUserId } from './utils/normalize';

/**
 * Validates that an IAgentConfig has all required fields populated.
 *
 * @param config - The agent configuration to validate.
 * @param agentType - The type identifier of the agent, used for error messages.
 * @throws Error if config is undefined or missing required fields.
 */
export function validateAgentConfig(config: IAgentConfig | undefined, agentType: string): void {
  if (!config) {
    throw new Error(
      `Agent config is required for '${agentType}'. ` +
        `Ensure AgentRegistry.getAgentConfig() returns a valid config.`
    );
  }

  const required: (keyof IAgentConfig)[] = ['id', 'name', 'systemPrompt', 'enabled'];
  const missing = required.filter(
    (key) => config[key] === undefined || config[key] === null || config[key] === ''
  );

  if (missing.length > 0) {
    throw new Error(
      `Agent config for '${agentType}' missing required fields: ${missing.join(', ')}. ` +
        `Ensure the config is fully populated in AgentRegistry or backbone.ts.`
    );
  }
}

/**
 * The core Agent class responsible for orchestrating LLM calls, tool execution,
 * and memory management.
 */
export class Agent {
  private emitter: AgentEmitter;

  constructor(
    private memory: IMemory,
    private provider: IProvider,
    private tools: ITool[],
    private systemPrompt: string,
    public config?: IAgentConfig
  ) {
    if (config) {
      validateAgentConfig(config, config.id);
    }
    this.emitter = new AgentEmitter(config);
  }

  async process(
    userId: string,
    userText: string,
    options: AgentProcessOptions = {}
  ): Promise<{
    responseText: string;
    attachments?: Attachment[];
    thought?: string;
    tool_calls?: ToolCall[];
    traceId?: string;
  }> {
    const {
      profile = this.config?.reasoningProfile ?? ReasoningProfile.STANDARD,
      context,
      isContinuation = false,
      isIsolated = false,
      initiatorId,
      depth = 0,
      traceId: incomingTraceId,
      taskId,
      nodeId: incomingNodeId,
      parentId: incomingParentId,
      sessionId,
      attachments: incomingAttachments,
      source = TraceSource.UNKNOWN,
      responseFormat: initialResponseFormat,
      taskTimeoutMs,
      timeoutBehavior = 'pause',
      communicationMode = this.config?.defaultCommunicationMode ?? 'text',
      sessionStateManager,
      approvedToolCalls,
      ignoreHandoff = false,
    } = options;

    const responseFormat =
      communicationMode === 'json'
        ? initialResponseFormat || DEFAULT_SIGNAL_SCHEMA
        : initialResponseFormat;

    const baseUserId = normalizeBaseUserId(userId);
    const { ClawTracer } = await import('./tracer');

    const tracer = new ClawTracer(
      baseUserId,
      source,
      incomingTraceId,
      incomingNodeId,
      incomingParentId,
      this.config?.id
    );
    const traceId = tracer.getTraceId();
    const effectiveTaskId = taskId ?? traceId;
    const nodeId = tracer.getNodeId();
    const parentId = tracer.getParentId();
    const currentInitiator = initiatorId ?? this.config?.id ?? 'orchestrator';

    if (!isContinuation) {
      await tracer.startTrace({
        userText,
        sessionId,
        agentId: this.config?.id,
        hasAttachments: !!incomingAttachments,
      });
    }

    const storageId = isIsolated
      ? `${(this.config?.id ?? 'unknown').toUpperCase()}#${userId}#${traceId}`
      : userId;

    const { isHumanTakingControl } = await import('./handoff');
    if (!ignoreHandoff && (await isHumanTakingControl(baseUserId))) {
      logger.info(`[Agent] Human control active for ${baseUserId}, entering OBSERVE mode.`);
      const responseText = 'HUMAN_TAKING_CONTROL: Entering observe mode.';
      await tracer.endTrace(responseText);
      return { responseText, traceId };
    }

    try {
      let activeModel = this.config?.model ?? SYSTEM.DEFAULT_MODEL;
      let activeProvider = this.config?.provider ?? SYSTEM.DEFAULT_PROVIDER;
      let activeProfile = profile;

      try {
        const globalProvider = (await ConfigManager.getRawConfig(
          CONFIG_KEYS.ACTIVE_PROVIDER
        )) as string;
        const globalModel = (await ConfigManager.getRawConfig(CONFIG_KEYS.ACTIVE_MODEL)) as string;
        if (globalProvider) activeProvider = globalProvider;
        if (globalModel) activeModel = globalModel;

        if (!globalProvider && !globalModel && this.config) {
          const { AgentRouter } = await import('./agent-router');
          const routed = AgentRouter.selectModel(this.config, { profile: activeProfile });
          activeProvider = routed.provider;
          activeModel = routed.model;
        }

        if (!process.env.VITEST) {
          const policy = await ConfigManager.getRawConfig(CONFIG_KEYS.OPTIMIZATION_POLICY);
          if (policy === OPTIMIZATION_POLICIES.AGGRESSIVE) activeProfile = ReasoningProfile.DEEP;
          else if (policy === OPTIMIZATION_POLICIES.CONSERVATIVE)
            activeProfile = ReasoningProfile.FAST;

          if (!globalModel && !activeModel) {
            const profileMap = (await ConfigManager.getRawConfig(
              CONFIG_KEYS.REASONING_PROFILES
            )) as Record<string, string>;
            if (profileMap?.[activeProfile]) activeModel = profileMap[activeProfile];
          }
        }
      } catch {
        logger.warn('Failed to fetch config from DDB, using defaults.');
      }

      if (userText.includes('(USER_ALREADY_NOTIFIED: true)')) {
        logger.info(`Silent completion for agent ${this.config?.id} (Already Notified)`);
        await tracer.endTrace('User already notified by sub-agent.');
        return { responseText: '', attachments: [] };
      }

      const { AgentAssembler } = await import('./agent/assembler');
      const {
        contextPrompt,
        messages,
        summary,
        contextLimit,
        activeModel: finalModel,
        activeProvider: finalProvider,
      } = await AgentAssembler.prepareContext(
        this.memory,
        this.provider,
        this.config,
        baseUserId,
        storageId,
        userText,
        incomingAttachments ?? [],
        {
          isIsolated,
          depth,
          activeModel,
          activeProvider,
          activeProfile,
          systemPrompt: this.systemPrompt,
        }
      );

      activeModel = finalModel;
      activeProvider = finalProvider;

      await this.memory.addMessage(storageId, {
        role: MessageRole.USER,
        content: userText,
        attachments: incomingAttachments,
      });

      const { AgentExecutor, AGENT_DEFAULTS } = await import('./agent/executor');
      const executor = new AgentExecutor(
        this.provider,
        this.tools,
        this.config?.id ?? 'unknown',
        this.config?.name ?? 'SuperClaw',
        contextPrompt,
        summary,
        contextLimit
      );

      let maxIterations = this.config?.maxIterations ?? AGENT_DEFAULTS.MAX_ITERATIONS;
      try {
        if (!process.env.VITEST) {
          const customMax = await ConfigManager.getRawConfig(CONFIG_KEYS.MAX_TOOL_ITERATIONS);
          if (customMax !== undefined) maxIterations = parseConfigInt(customMax, maxIterations);
        }
      } catch {
        logger.warn(
          `Failed to fetch max_tool_iterations from DDB, using default ${maxIterations}.`
        );
      }

      const {
        responseText: initialResponseText,
        paused,
        asyncWait,
        attachments: resultAttachments,
        thought: resultThought,
        tool_calls: resultToolCalls,
        usage: loopUsage,
      } = await executor.runLoop(messages, {
        activeModel,
        activeProvider,
        activeProfile,
        maxIterations,
        tracer,
        context,
        traceId,
        taskId: effectiveTaskId,
        nodeId,
        parentId,
        currentInitiator,
        depth,
        sessionId,
        userId: baseUserId,
        userText,
        mainConversationId: userId,
        responseFormat,
        taskTimeoutMs,
        timeoutBehavior,
        sessionStateManager,
        approvedToolCalls,
      });

      if (!process.env.VITEST && loopUsage) {
        try {
          const { emitMetrics, METRICS } = await import('./metrics');
          emitMetrics([
            METRICS.agentDuration(this.config?.id ?? 'unknown', loopUsage.durationMs),
            METRICS.agentInvoked(this.config?.id ?? 'unknown'),
          ]).catch(() => {});

          const { TokenTracker } = await import('./metrics/token-usage');
          const agentId = this.config?.id ?? 'unknown';
          await TokenTracker.recordInvocation({
            timestamp: Date.now(),
            traceId: traceId ?? '',
            agentId,
            provider: activeProvider ?? 'unknown',
            model: activeModel ?? 'unknown',
            inputTokens: loopUsage.totalInputTokens,
            outputTokens: loopUsage.totalOutputTokens,
            totalTokens: loopUsage.totalInputTokens + loopUsage.totalOutputTokens,
            toolCalls: loopUsage.toolCallCount,
            taskType: 'agent_process',
            success: !paused,
            durationMs: loopUsage.durationMs,
          });
          await TokenTracker.updateRollup(agentId, {
            inputTokens: loopUsage.totalInputTokens,
            outputTokens: loopUsage.totalOutputTokens,
            toolCalls: loopUsage.toolCallCount,
            success: !paused,
          });
        } catch {
          logger.warn('Failed to emit agent metrics or persist token usage');
        }
      }

      let responseText = initialResponseText;

      if (paused) {
        await this.memory.addMessage(storageId, {
          role: MessageRole.ASSISTANT,
          content: responseText,
          agentName: this.config?.name ?? 'SuperClaw',
          traceId,
          messageId: this.config?.id === 'superclaw' ? traceId : `${traceId}-${this.config?.id}`,
          tool_calls: resultToolCalls,
        });

        if (!asyncWait) {
          await this.emitter.emitContinuation(userId, userText, tracer.getTraceId() ?? 'unknown', {
            initiatorId: currentInitiator,
            depth,
            sessionId,
            nodeId: nodeId ?? 'unknown',
            parentId: parentId ?? 'unknown',
            attachments: incomingAttachments,
          });
        }
        return {
          responseText,
          attachments: resultAttachments,
          tool_calls: resultToolCalls,
          traceId,
        };
      }

      if (communicationMode === 'json' && responseText) {
        try {
          const parsed = JSON.parse(responseText);
          if (parsed.message) responseText = parsed.message;
          else if (parsed.plan) responseText = parsed.plan;
        } catch {
          // Keep raw text
        }
      }

      await this.memory.addMessage(storageId, {
        role: MessageRole.ASSISTANT,
        content: responseText,
        agentName: this.config?.name ?? 'SuperClaw',
        traceId,
        messageId: this.config?.id === 'superclaw' ? traceId : `${traceId}-${this.config?.id}`,
        attachments: resultAttachments,
        tool_calls: resultToolCalls,
      });

      await tracer.endTrace(responseText);

      await this.emitter.considerReflection(
        isIsolated,
        userId,
        messages, // history for reflection
        userText,
        tracer.getTraceId(),
        messages,
        responseText,
        nodeId,
        parentId,
        sessionId
      );

      return {
        responseText: responseText,
        thought:
          resultThought || (initialResponseText !== responseText ? initialResponseText : undefined),
        attachments: resultAttachments,
        tool_calls: resultToolCalls,
        traceId,
      };
    } catch (error) {
      const errorDetail = error instanceof Error ? error.message : String(error);
      logger.error(`[Agent.process] Critical failure: ${errorDetail}`, error);

      try {
        const gapId = `GAP#PROC#${Date.now()}`;
        await this.memory.setGap(
          gapId,
          `Execution failure for user ${userId} / session ${sessionId}. Error: ${errorDetail}`,
          {
            category: InsightCategory.STRATEGIC_GAP,
            confidence: 10,
            impact: 8,
            complexity: 5,
            risk: 5,
            urgency: 7,
            priority: 7,
          }
        );
      } catch (gapError) {
        logger.error('Failed to log strategic gap during error recovery:', gapError);
      }

      return { responseText: AGENT_ERRORS.PROCESS_FAILURE };
    }
  }

  async *stream(
    userId: string,
    userText: string,
    options: AgentProcessOptions = {}
  ): AsyncIterable<import('./types/index').MessageChunk> {
    const {
      profile = this.config?.reasoningProfile ?? ReasoningProfile.STANDARD,
      context,
      isContinuation = false,
      isIsolated = false,
      initiatorId,
      depth = 0,
      traceId: incomingTraceId,
      taskId,
      nodeId: incomingNodeId,
      parentId: incomingParentId,
      sessionId,
      attachments: incomingAttachments,
      source = TraceSource.UNKNOWN,
      responseFormat: initialResponseFormat,
      taskTimeoutMs,
      timeoutBehavior = 'pause',
      communicationMode = this.config?.defaultCommunicationMode ?? 'text',
      sessionStateManager,
      approvedToolCalls,
      ignoreHandoff = false,
    } = options;

    const responseFormat =
      communicationMode === 'json'
        ? initialResponseFormat || DEFAULT_SIGNAL_SCHEMA
        : initialResponseFormat;

    const baseUserId = normalizeBaseUserId(userId);
    const { ClawTracer } = await import('./tracer');

    const tracer = new ClawTracer(
      baseUserId,
      source,
      incomingTraceId,
      incomingNodeId,
      incomingParentId,
      this.config?.id
    );
    const traceId = tracer.getTraceId();
    const effectiveTaskId = taskId ?? traceId;
    const nodeId = tracer.getNodeId();
    const parentId = tracer.getParentId();
    const currentInitiator = initiatorId ?? this.config?.id ?? 'orchestrator';

    if (!isContinuation) {
      await tracer.startTrace({
        userText,
        sessionId,
        agentId: this.config?.id,
        hasAttachments: !!incomingAttachments,
      });
    }

    const storageId = isIsolated
      ? `${(this.config?.id ?? 'unknown').toUpperCase()}#${userId}#${traceId}`
      : userId;

    const { isHumanTakingControl } = await import('./handoff');
    if (!ignoreHandoff && (await isHumanTakingControl(baseUserId))) {
      logger.info(`[Agent.stream] Human control active for ${baseUserId}, entering OBSERVE mode.`);
      const content = 'HUMAN_TAKING_CONTROL: Entering observe mode.';
      yield { content, messageId: traceId };
      await tracer.endTrace(content);
      return;
    }

    if (userText.includes('(USER_ALREADY_NOTIFIED: true)')) {
      logger.info(`Silent completion for agent ${this.config?.id} (Already Notified)`);
      await tracer.endTrace('User already notified by sub-agent.');
      return;
    }

    const activeModel = this.config?.model ?? SYSTEM.DEFAULT_MODEL;
    const activeProvider = this.config?.provider ?? SYSTEM.DEFAULT_PROVIDER;
    const activeProfile = profile;

    const { AgentAssembler } = await import('./agent/assembler');
    const {
      contextPrompt,
      messages,
      summary,
      contextLimit,
      activeModel: finalModel,
      activeProvider: finalProvider,
    } = await AgentAssembler.prepareContext(
      this.memory,
      this.provider,
      this.config,
      baseUserId,
      storageId,
      userText,
      incomingAttachments ?? [],
      {
        isIsolated,
        depth,
        activeModel,
        activeProvider,
        activeProfile,
        systemPrompt: this.systemPrompt,
      }
    );

    await this.memory.addMessage(storageId, {
      role: MessageRole.USER,
      content: userText,
      attachments: incomingAttachments,
    });

    const executor = new (await import('./agent/executor')).AgentExecutor(
      this.provider,
      this.tools,
      this.config?.id ?? 'unknown',
      this.config?.name ?? 'SuperClaw',
      contextPrompt,
      summary,
      contextLimit
    );

    const stream = executor.streamLoop(messages, {
      activeModel: finalModel,
      activeProvider: finalProvider,
      activeProfile,
      maxIterations:
        this.config?.maxIterations ??
        (await import('./agent/executor')).AGENT_DEFAULTS.MAX_ITERATIONS,
      tracer,
      emitter: this.emitter,
      context,
      traceId,
      taskId: effectiveTaskId,
      nodeId,
      parentId,
      currentInitiator,
      depth,
      sessionId,
      userId: baseUserId,
      userText,
      mainConversationId: userId,
      responseFormat,
      communicationMode,
      taskTimeoutMs,
      timeoutBehavior,
      sessionStateManager,
      approvedToolCalls,
    });
    let fullContent = '';
    let fullThought = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for await (const chunk of stream) {
      if (chunk.content) fullContent += chunk.content;
      if (chunk.thought) fullThought += chunk.thought;
      if (chunk.usage) {
        totalInputTokens += chunk.usage.prompt_tokens;
        totalOutputTokens += chunk.usage.completion_tokens;
      }
      yield chunk;
    }

    if (!process.env.VITEST) {
      const { emitMetrics, METRICS } = await import('./metrics');
      emitMetrics([
        METRICS.tokensInput(totalInputTokens, nodeId, activeProvider),
        METRICS.tokensOutput(totalOutputTokens, nodeId, activeProvider),
      ]).catch(() => {});
    }

    await this.memory.addMessage(storageId, {
      role: MessageRole.ASSISTANT,
      content: fullContent,
      thought: fullThought,
      agentName: this.config?.name ?? 'SuperClaw',
      traceId,
      messageId: this.config?.id === 'superclaw' ? traceId : `${traceId}-${this.config?.id}`,
    });
    await tracer.endTrace(fullContent);
  }
}
