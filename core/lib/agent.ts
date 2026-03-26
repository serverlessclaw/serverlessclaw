import {
  IMemory,
  IProvider,
  ITool,
  Message,
  ReasoningProfile,
  MessageRole,
  IAgentConfig,
  TraceSource,
  Attachment,
  InsightCategory,
  ToolCall,
} from './types/index';
import { logger } from './logger';
import {
  SYSTEM,
  AGENT_ERRORS,
  MEMORY_KEYS,
  CONFIG_KEYS,
  OPTIMIZATION_POLICIES,
  LIMITS,
} from './constants';
import { ConfigManager } from './registry/config';
import { AgentProcessOptions } from './agent/options';
import { AgentEmitter } from './agent/emitter';
import { parseConfigInt } from './providers/utils';
import { DEFAULT_SIGNAL_SCHEMA } from './agent/schema';
import { normalizeBaseUserId } from './utils/normalize';

// DEFAULT_SIGNAL_SCHEMA moved to ./agent/schema.ts

/**
 * Validates that an IAgentConfig has all required fields populated.
 * Throws with a clear error message if critical fields are missing.
 * Use this at agent construction time to fail fast on misconfiguration.
 *
 * @param config - The agent config to validate.
 * @param agentType - The agent type name for error messages.
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
 * and memory management. It acts as the primary execution engine for both
 * backbone (system) and user-defined agents.
 */
export class Agent {
  /** Emitter for agent-related events, including reflections and continuations. */
  private emitter: AgentEmitter;

  /**
   * Initializes a new Agent instance.
   *
   * @param memory - The memory provider for history and distillation.
   * @param provider - The LLM provider for model interactions.
   * @param tools - The list of tools available to the agent.
   * @param systemPrompt - The core identity and instructions for the agent.
   * @param config - Optional configuration and metadata for the agent.
   */
  constructor(
    private memory: IMemory,
    private provider: IProvider,
    private tools: ITool[],
    private systemPrompt: string,
    public config?: IAgentConfig
  ) {
    // Structural Enforcement: fail-fast on misconfiguration
    if (config) {
      validateAgentConfig(config, config.id);
    }
    this.emitter = new AgentEmitter(config);
  }

  /**
   * Processes a user message, potentially performing multiple tool-calling iterations.
   * This method handles memory retrieval, model/provider resolution, prompt assembly,
   * and the core execution loop.
   *
   * @param userId - The unique identifier for the user or conversation.
   * @param userText - The text content of the user's message.
   * @param options - Optional configuration for this specific processing run.
   * @returns A promise that resolves to the agent's response, including text, attachments, and trace ID.
   */
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
    } = options;

    const responseFormat =
      communicationMode === 'json'
        ? initialResponseFormat || DEFAULT_SIGNAL_SCHEMA
        : initialResponseFormat;

    const baseUserId = normalizeBaseUserId(userId);
    const { ClawTracer } = await import('./tracer');
    const { ContextManager } = await import('./agent/context-manager');
    const { AgentExecutor, AGENT_DEFAULTS, AGENT_LOG_MESSAGES } = await import('./agent/executor');
    const { AgentContext } = await import('./agent/context');

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

    try {
      // 1. Memory Retrieval (GAP #5: Include global lessons for cross-session knowledge)
      const history = await this.memory.getHistory(storageId);
      const [distilled, lessons, prefPrefixed, prefRaw, globalLessons] = await Promise.all([
        this.memory.getDistilledMemory(baseUserId),
        this.memory.getLessons(baseUserId),
        this.memory.searchInsights(`USER#${baseUserId}`, '*', InsightCategory.USER_PREFERENCE),
        this.memory.searchInsights(baseUserId, '*', InsightCategory.USER_PREFERENCE),
        this.memory.getGlobalLessons(5),
      ]);

      const preferences = {
        items: [...(prefPrefixed.items ?? []), ...(prefRaw.items ?? [])],
      };

      const facts = [
        ...distilled.split('\n').filter(Boolean),
        ...(preferences.items?.map((i) => i.content) ?? []),
      ].join('\n');

      let recoveryContext = '';
      try {
        const recoveryData = await this.memory.getDistilledMemory(
          SYSTEM.RECOVERY_KEY ?? MEMORY_KEYS.RECOVERY
        );
        if (recoveryData) {
          recoveryContext = `${AGENT_LOG_MESSAGES.RECOVERY_LOG_PREFIX}${recoveryData}`;
          await this.memory.updateDistilledMemory(SYSTEM.RECOVERY_KEY ?? MEMORY_KEYS.RECOVERY, '');
        }
      } catch (e) {
        logger.error('Error checking recovery context:', e);
      }

      await this.memory.addMessage(storageId, {
        role: MessageRole.USER,
        content: userText,
        attachments: incomingAttachments,
      });

      // Silent completion if user was already notified by sub-agent
      if (userText.includes('(USER_ALREADY_NOTIFIED: true)')) {
        logger.info(`Silent completion for agent ${this.config?.id} (Already Notified)`);
        await tracer.endTrace('User already notified by sub-agent.');
        return { responseText: '', attachments: [] };
      }

      // 2. Model/Provider Resolution (GAP #4: Per-agent model selection via AgentRouter)
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

        // GAP #4: If no global override, use AgentRouter for dynamic model selection
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

      // 3. Prompt Assembly (GAP #5: Include global lessons)
      const globalLessonsBlock =
        globalLessons.length > 0
          ? `\n\n[COLLECTIVE_SWARM_INTELLIGENCE]:\nThese are system-wide lessons learned across ALL sessions. Apply them universally:\n${globalLessons.map((l) => `- ${l}`).join('\n')}\n`
          : '';

      let contextPrompt = this.systemPrompt;
      if (recoveryContext) contextPrompt += recoveryContext;
      contextPrompt += `\n\n${AgentContext.getMemoryIndexBlock(distilled, lessons.length, preferences.items.length)}`;
      contextPrompt += `\n\n[INTELLIGENCE]\n${facts.length > 0 ? facts : 'No persistent knowledge available for this user yet.'}\n\n`;
      contextPrompt += globalLessonsBlock;
      contextPrompt += `\n\n${AgentContext.getIdentityBlock(
        this.config,
        activeModel ?? SYSTEM.DEFAULT_MODEL,
        activeProvider ?? SYSTEM.DEFAULT_PROVIDER,
        activeProfile,
        depth
      )}`;

      contextPrompt += `
      [RELATIONSHIP_CONTEXT]:
      - MODE: ${isIsolated ? 'SYSTEM_TASK' : 'USER_CONSULTATION'}
      - AUDIENCE: ${isIsolated ? 'Orchestrator' : 'Human User'}
      - BEHAVIOR: ${isIsolated ? 'Be technical, precise, and structured.' : 'Be friendly, direct, and conversational. Skip internal monologue.'}
      `;

      const currentMessage: Message = {
        role: MessageRole.USER,
        content: userText,
        attachments: incomingAttachments,
      };

      const fullHistory = [...history, currentMessage];
      const summary = await this.memory.getSummary(storageId);

      const capabilities = await this.provider.getCapabilities(activeModel);
      const contextLimit = capabilities.contextWindow ?? LIMITS.MAX_CONTEXT_LENGTH;

      const managed = await ContextManager.getManagedContext(
        fullHistory,
        summary,
        contextPrompt,
        contextLimit,
        { model: activeModel, provider: activeProvider }
      );

      const messages: Message[] = managed.messages;

      // 4. Summarization Trigger (Background)
      if (
        await ContextManager.needsSummarization(
          fullHistory,
          contextLimit,
          undefined,
          activeModel,
          activeProvider
        )
      ) {
        ContextManager.summarize(this.memory, storageId, this.provider, fullHistory).catch((e) =>
          logger.error('Background summarization failed:', e)
        );
      }

      // 5. Execution Loop
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

      // Emit agent-level metrics + persist token usage
      if (!process.env.VITEST && loopUsage) {
        try {
          const { emitMetrics, METRICS } = await import('./metrics');
          emitMetrics([
            METRICS.agentDuration(this.config?.id ?? 'unknown', loopUsage.durationMs),
            METRICS.agentInvoked(this.config?.id ?? 'unknown'),
          ]).catch(() => {});

          const { TokenTracker } = await import('./token-usage');
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

        // Only emit continuation if NOT waiting for an asynchronous delegation/event
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

      // 5. Finalize and Response
      // 2026 Strategy: Intelligently extract responseText for humans if in JSON mode.
      // This allows the agent to maintain structured communication with its peers while
      // still providing legible status updates to the user.
      if (communicationMode === 'json' && responseText) {
        try {
          const parsed = JSON.parse(responseText);
          // Standard field names for human messaging
          if (parsed.message) responseText = parsed.message;
          else if (parsed.plan) responseText = parsed.plan; // Better UX for Planner
        } catch {
          // Keep raw text if not JSON-parseable (fallback)
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

      // 6. Reflection Trigger
      await this.emitter.considerReflection(
        isIsolated,
        userId,
        history,
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

      // Log a strategic gap for the system to evolve
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

  /**
   * Performs a streaming completion call to the agent.
   */
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
    } = options;

    const responseFormat =
      communicationMode === 'json'
        ? initialResponseFormat || DEFAULT_SIGNAL_SCHEMA
        : initialResponseFormat;

    const baseUserId = normalizeBaseUserId(userId);
    const { ClawTracer } = await import('./tracer');
    const { ContextManager } = await import('./agent/context-manager');
    const { AgentExecutor, AGENT_DEFAULTS } = await import('./agent/executor');
    const { AgentContext } = await import('./agent/context');

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

    await this.memory.addMessage(storageId, {
      role: MessageRole.USER,
      content: userText,
      attachments: incomingAttachments,
    });

    // Silent completion if user was already notified by sub-agent
    if (userText.includes('(USER_ALREADY_NOTIFIED: true)')) {
      logger.info(`Silent completion for agent ${this.config?.id} (Already Notified)`);
      await tracer.endTrace('User already notified by sub-agent.');
      return;
    }

    const history = await this.memory.getHistory(storageId);
    const [distilled, lessons, prefPrefixed, prefRaw] = await Promise.all([
      this.memory.getDistilledMemory(baseUserId),
      this.memory.getLessons(baseUserId),
      this.memory.searchInsights(`USER#${baseUserId}`, '*', InsightCategory.USER_PREFERENCE),
      this.memory.searchInsights(baseUserId, '*', InsightCategory.USER_PREFERENCE),
    ]);

    const preferences = {
      items: [...(prefPrefixed.items ?? []), ...(prefRaw.items ?? [])],
    };

    const facts = [
      ...distilled.split('\n').filter(Boolean),
      ...(preferences.items?.map((i) => i.content) ?? []),
    ].join('\n');

    const activeModel = this.config?.model ?? SYSTEM.DEFAULT_MODEL;
    const activeProvider = this.config?.provider ?? SYSTEM.DEFAULT_PROVIDER;
    const activeProfile = profile;

    let contextPrompt = this.systemPrompt;
    contextPrompt += `\n\n${AgentContext.getMemoryIndexBlock(distilled, lessons.length, preferences.items.length)}`;
    contextPrompt += `\n\n[INTELLIGENCE]\n${facts.length > 0 ? facts : 'No persistent knowledge available for this user yet.'}\n\n`;
    contextPrompt += `\n\n${AgentContext.getIdentityBlock(
      this.config,
      activeModel ?? SYSTEM.DEFAULT_MODEL,
      activeProvider ?? SYSTEM.DEFAULT_PROVIDER,
      activeProfile,
      depth
    )}`;

    contextPrompt += `
      [RELATIONSHIP_CONTEXT]:
      - MODE: ${isIsolated ? 'SYSTEM_TASK' : 'USER_CONSULTATION'}
      - AUDIENCE: ${isIsolated ? 'Orchestrator' : 'Human User'}
      - BEHAVIOR: ${isIsolated ? 'Be technical, precise, and structured.' : 'Be friendly, direct, and conversational. Skip internal monologue.'}
      `;

    const currentMessage: Message = {
      role: MessageRole.USER,
      content: userText,
      attachments: incomingAttachments,
    };
    const fullHistory = [...history, currentMessage];
    const summary = await this.memory.getSummary(storageId);

    const capabilities = await this.provider.getCapabilities(activeModel);
    const contextLimit = capabilities.contextWindow ?? LIMITS.MAX_CONTEXT_LENGTH;

    const managed = await ContextManager.getManagedContext(
      fullHistory,
      summary,
      contextPrompt,
      contextLimit,
      { model: activeModel, provider: activeProvider }
    );

    const executor = new AgentExecutor(
      this.provider,
      this.tools,
      this.config?.id ?? 'unknown',
      this.config?.name ?? 'SuperClaw',
      contextPrompt,
      summary,
      contextLimit
    );

    const stream = executor.streamLoop(managed.messages, {
      activeModel,
      activeProvider,
      activeProfile,
      maxIterations: this.config?.maxIterations ?? AGENT_DEFAULTS.MAX_ITERATIONS,
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

    // After stream completes, emit metrics, save to memory and end trace
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
