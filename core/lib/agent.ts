import {
  IMemory,
  IProvider,
  ITool,
  ReasoningProfile,
  MessageRole,
  IAgentConfig,
  TraceSource,
  Attachment,
  ToolCall,
  MessageChunk,
} from './types/index';
import { logger } from './logger';
import { AGENT_ERRORS, CONFIG_KEYS } from './constants';
import { ConfigManager } from './registry/config';
import { AgentProcessOptions } from './agent/options';
import { AgentEmitter } from './agent/emitter';
import { parseConfigInt } from './providers/utils';
import { DEFAULT_SIGNAL_SCHEMA } from './agent/schema';
import { initializeTracer } from './agent/tracer-init';
import { resolveAgentConfig } from './agent/config-resolver';

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

  const required: (keyof IAgentConfig)[] = ['id', 'name', 'enabled'];
  const missing = required.filter(
    (key) => config[key] === undefined || config[key] === null || config[key] === ''
  );

  if (missing.length > 0) {
    throw new Error(
      `Agent config for '${agentType}' missing required fields: ${missing.join(', ')}. ` +
        `Ensure the config is fully populated in AgentRegistry or backbone.ts.`
    );
  }

  // systemPrompt is mandatory for LLM agents (default type)
  if (config.agentType !== 'logic' && !config.systemPrompt) {
    throw new Error(
      `LLM Agent config for '${agentType}' missing required field: systemPrompt. ` +
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
    public systemPrompt: string,
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
      workspaceId,
      attachments: incomingAttachments,
      source = TraceSource.UNKNOWN,
      responseFormat: initialResponseFormat,
      taskTimeoutMs,
      timeoutBehavior = 'pause',
      communicationMode = this.config?.defaultCommunicationMode ?? 'text',
      sessionStateManager,
      approvedToolCalls,
      ignoreHandoff = false,
      pageContext,
      tokenBudget = this.config?.tokenBudget,
      costLimit = this.config?.costLimit,
      priorTokenUsage,
    } = options;

    const responseFormat =
      communicationMode === 'json'
        ? initialResponseFormat || DEFAULT_SIGNAL_SCHEMA
        : initialResponseFormat;

    const { tracer, traceId, baseUserId } = await initializeTracer(
      userId,
      source,
      incomingTraceId,
      incomingNodeId,
      incomingParentId,
      this.config?.id,
      isContinuation,
      userText,
      sessionId,
      !!incomingAttachments
    );

    const effectiveTaskId = taskId ?? traceId;
    const nodeId = tracer.getNodeId();
    const parentId = tracer.getParentId();
    const currentInitiator = initiatorId ?? this.config?.id ?? 'orchestrator';

    const storageId = isIsolated
      ? `${(this.config?.id ?? 'unknown').toUpperCase()}#${userId}#${traceId}`
      : userId;

    const { isHumanTakingControl } = await import('./handoff');
    if (!ignoreHandoff && (await isHumanTakingControl(baseUserId, sessionId))) {
      logger.info(`[Agent] Human control active for ${baseUserId}, entering OBSERVE mode.`);
      const responseText = 'HUMAN_TAKING_CONTROL: Entering observe mode.';
      await tracer.endTrace(responseText);
      return { responseText, traceId };
    }

    import('./agent/warmup')
      .then(({ triggerSmartWarmup }) => {
        triggerSmartWarmup(userText, depth, sessionId, sessionStateManager);
      })
      .catch(() => {});

    try {
      const {
        activeModel: resolvedModel,
        activeProvider: resolvedProvider,
        activeProfile: resolvedProfile,
      } = await resolveAgentConfig(this.config, profile);

      let activeModel = resolvedModel;
      let activeProvider = resolvedProvider;
      const activeProfile = resolvedProfile;

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
        (incomingAttachments as Attachment[]) ?? [],
        {
          isIsolated,
          depth,
          activeModel,
          activeProvider,
          activeProfile,
          systemPrompt: this.systemPrompt,
          pageContext,
        }
      );

      activeModel = finalModel;
      activeProvider = finalProvider;

      await this.memory.addMessage(
        storageId,
        {
          role: MessageRole.USER,
          content: userText,
          attachments: incomingAttachments as Attachment[],
          pageContext,
          traceId,
          messageId: traceId,
        },
        workspaceId
      );

      const { AgentExecutor, AGENT_DEFAULTS } = await import('./agent/executor');
      const executor = new AgentExecutor(
        this.provider,
        this.tools,
        this.config?.id ?? 'unknown',
        this.config?.name ?? 'SuperClaw',
        contextPrompt,
        summary,
        contextLimit,
        this.config
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
        tokenBudget,
        costLimit,
        priorTokenUsage,
      });

      if (sessionId && sessionStateManager) {
        await sessionStateManager.autoRenew(sessionId, this.config?.id ?? 'unknown');
      }

      // Check for signal drift (Eye Silo Silo 5)
      await tracer.detectDrift();

      if (!process.env.VITEST && loopUsage) {
        try {
          const { emitMetrics, METRICS } = await import('./metrics');
          const agentId = this.config?.id ?? 'unknown';
          const success = !paused;
          emitMetrics([
            METRICS.agentDuration(agentId, loopUsage.durationMs),
            METRICS.agentInvoked(agentId, success),
          ]).catch(() => {});

          const { TokenTracker } = await import('./metrics/token-usage');
          TokenTracker.recordInvocation({
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
          }).catch(() => {});
          TokenTracker.updateRollup(agentId, {
            inputTokens: loopUsage.totalInputTokens,
            outputTokens: loopUsage.totalOutputTokens,
            toolCalls: loopUsage.toolCallCount,
            success: !paused,
            durationMs: loopUsage.durationMs,
          }).catch(() => {});
        } catch {
          logger.warn('Failed to emit agent metrics or persist token usage');
        }
      }

      let responseText = initialResponseText;
      if (communicationMode === 'json' && responseText) {
        try {
          const parsed = JSON.parse(responseText);
          responseText = parsed.message || parsed.plan || responseText;
        } catch {
          // Fallback to raw text if not valid JSON
        }
      }

      if (paused) {
        await this.memory.addMessage(
          storageId,
          {
            role: MessageRole.ASSISTANT,
            content: responseText,
            agentName: this.config?.name ?? 'SuperClaw',
            traceId,
            messageId: this.config?.id === 'superclaw' ? traceId : `${traceId}-${this.config?.id}`,
            tool_calls: resultToolCalls,
          },
          workspaceId
        );

        if (!asyncWait) {
          await this.emitter.emitContinuation(userId, userText, tracer.getTraceId() ?? 'unknown', {
            initiatorId: currentInitiator,
            depth,
            sessionId,
            workspaceId,
            nodeId: nodeId ?? 'unknown',
            parentId: parentId ?? 'unknown',
            priorInputTokens: loopUsage?.totalInputTokens ?? 0,
            priorOutputTokens: loopUsage?.totalOutputTokens ?? 0,
            priorTotalTokens:
              (loopUsage?.totalInputTokens ?? 0) + (loopUsage?.totalOutputTokens ?? 0),
            tokenBudget,
            costLimit,
          });
        }
      } else {
        await this.memory.addMessage(
          storageId,
          {
            role: MessageRole.ASSISTANT,
            content: responseText,
            thought: resultThought,
            agentName: this.config?.name ?? 'SuperClaw',
            traceId,
            messageId: this.config?.id === 'superclaw' ? traceId : `${traceId}-${this.config?.id}`,
          },
          workspaceId
        );
      }

      await tracer.endTrace(responseText);
      return {
        responseText,
        attachments: resultAttachments,
        thought: resultThought,
        tool_calls: resultToolCalls,
        traceId,
      };
    } catch (error) {
      logger.error(`[Agent] Critical error in process loop:`, error);
      await tracer.failTrace(AGENT_ERRORS.PROCESS_FAILURE, { error: String(error) });
      throw error;
    }
  }

  async *stream(
    userId: string,
    userText: string,
    options: AgentProcessOptions = {}
  ): AsyncGenerator<MessageChunk> {
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
      workspaceId,
      attachments: incomingAttachments,
      source = TraceSource.UNKNOWN,
      responseFormat: initialResponseFormat,
      communicationMode = this.config?.defaultCommunicationMode ?? 'text',
      taskTimeoutMs,
      timeoutBehavior = 'pause',
      sessionStateManager,
      approvedToolCalls,
      ignoreHandoff = false,
      pageContext,
      tokenBudget = this.config?.tokenBudget,
      costLimit = this.config?.costLimit,
      priorTokenUsage,
    } = options;

    const responseFormat =
      communicationMode === 'json'
        ? initialResponseFormat || DEFAULT_SIGNAL_SCHEMA
        : initialResponseFormat;

    const { tracer, traceId, baseUserId } = await initializeTracer(
      userId,
      source,
      incomingTraceId,
      incomingNodeId,
      incomingParentId,
      this.config?.id,
      isContinuation,
      userText,
      sessionId,
      !!incomingAttachments
    );

    const effectiveTaskId = taskId ?? traceId;
    const nodeId = tracer.getNodeId();
    const parentId = tracer.getParentId();
    const currentInitiator = initiatorId ?? this.config?.id ?? 'orchestrator';

    const storageId = isIsolated
      ? `${(this.config?.id ?? 'unknown').toUpperCase()}#${userId}#${traceId}`
      : userId;

    const { isHumanTakingControl } = await import('./handoff');
    if (!ignoreHandoff && (await isHumanTakingControl(baseUserId, sessionId))) {
      logger.info(`[Agent] Human control active for ${baseUserId}, entering OBSERVE mode.`);
      yield { content: 'HUMAN_TAKING_CONTROL: Entering observe mode.' };
      await tracer.endTrace('HUMAN_TAKING_CONTROL');
      return;
    }

    import('./agent/warmup')
      .then(({ triggerSmartWarmup }) => {
        triggerSmartWarmup(userText, depth, sessionId, sessionStateManager);
      })
      .catch(() => {});

    const {
      activeModel: resolvedModel,
      activeProvider: resolvedProvider,
      activeProfile: resolvedProfile,
    } = await resolveAgentConfig(this.config, profile);

    const activeModel = resolvedModel;
    const activeProvider = resolvedProvider;
    const activeProfile = resolvedProfile;

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
      (incomingAttachments as Attachment[]) ?? [],
      {
        isIsolated,
        depth,
        activeModel,
        activeProvider,
        activeProfile,
        systemPrompt: this.systemPrompt,
        pageContext,
      }
    );

    await this.memory.addMessage(
      storageId,
      {
        role: MessageRole.USER,
        content: userText,
        attachments: incomingAttachments as Attachment[],
        pageContext,
        traceId,
        messageId: traceId,
      },
      workspaceId
    );

    const executor = new (await import('./agent/executor')).AgentExecutor(
      this.provider,
      this.tools,
      this.config?.id ?? 'unknown',
      this.config?.name ?? 'SuperClaw',
      contextPrompt,
      summary,
      contextLimit,
      this.config
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
      tokenBudget,
      costLimit,
      priorTokenUsage,
    });
    let fullContent = '';
    let fullThought = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
      for await (const chunk of stream) {
        if (options.sessionId && sessionStateManager) {
          await sessionStateManager.autoRenew(options.sessionId, this.config?.id ?? 'unknown');
        }

        // Periodically check for signal drift (Eye Silo Silo 5)
        await tracer.detectDrift();

        if (chunk.content) fullContent += chunk.content;
        if (chunk.thought) fullThought += chunk.thought;
        if (chunk.usage) {
          totalInputTokens += chunk.usage.prompt_tokens;
          totalOutputTokens += chunk.usage.completion_tokens;
        }
        yield { ...chunk, agentName: this.config?.name };
      }
    } catch (streamError) {
      logger.error(`[Agent] Stream error:`, streamError);
      await tracer.failTrace(String(streamError), { error: String(streamError) });
      throw streamError;
    }

    if (!process.env.VITEST) {
      const { emitMetrics, METRICS } = await import('./metrics');
      emitMetrics([
        METRICS.tokensInput(totalInputTokens, nodeId, activeProvider),
        METRICS.tokensOutput(totalOutputTokens, nodeId, activeProvider),
      ]).catch(() => {});
    }

    let finalResponseText = fullContent;
    if (communicationMode === 'json' && finalResponseText) {
      try {
        const parsed = JSON.parse(finalResponseText);
        finalResponseText = parsed.message || parsed.plan || finalResponseText;
      } catch {
        // Fallback to raw
      }
    }

    await this.memory.addMessage(
      storageId,
      {
        role: MessageRole.ASSISTANT,
        content: finalResponseText,
        thought: fullThought,
        agentName: this.config?.name ?? 'SuperClaw',
        traceId,
        messageId: this.config?.id === 'superclaw' ? traceId : `${traceId}-${this.config?.id}`,
      },
      workspaceId
    );
    await tracer.endTrace(fullContent);
  }
}
