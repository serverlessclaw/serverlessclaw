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

// DEFAULT_SIGNAL_SCHEMA moved to ./agent/schema.ts

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
  ): Promise<{ responseText: string; attachments?: Attachment[]; traceId?: string }> {
    const {
      profile = this.config?.reasoningProfile ?? ReasoningProfile.STANDARD,
      context,
      isContinuation = false,
      isIsolated = false,
      initiatorId,
      depth = 0,
      traceId: incomingTraceId,
      nodeId: incomingNodeId,
      parentId: incomingParentId,
      sessionId,
      attachments: incomingAttachments,
      source = TraceSource.UNKNOWN,
      responseFormat: initialResponseFormat,
      taskTimeoutMs,
      timeoutBehavior = 'pause',
      communicationMode = this.config?.defaultCommunicationMode ?? 'text',
    } = options;

    const responseFormat =
      communicationMode === 'json'
        ? initialResponseFormat || DEFAULT_SIGNAL_SCHEMA
        : initialResponseFormat;

    const baseUserId = userId.startsWith(MEMORY_KEYS.CONVERSATION_PREFIX)
      ? userId.split('#')[1]
      : userId;
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
    const nodeId = tracer.getNodeId();
    const parentId = tracer.getParentId();
    const currentInitiator = initiatorId ?? this.config?.id ?? 'unknown';

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
      // 1. Memory Retrieval
      const history = await this.memory.getHistory(storageId);
      const distilled = await this.memory.getDistilledMemory(baseUserId);
      const lessons = await this.memory.getLessons(baseUserId);

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

      // 2. Model/Provider Resolution
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

      // 3. Prompt Assembly
      let contextPrompt = this.systemPrompt;
      if (recoveryContext) contextPrompt += recoveryContext;
      contextPrompt += `\n\n${AgentContext.getMemoryIndexBlock(distilled, lessons.length)}`;
      contextPrompt += `\n\n${AgentContext.getIdentityBlock(
        this.config,
        activeModel ?? SYSTEM.DEFAULT_MODEL,
        activeProvider ?? SYSTEM.DEFAULT_PROVIDER,
        activeProfile,
        depth
      )}`;

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
        contextLimit
      );

      const messages: Message[] = managed.messages;

      // 4. Summarization Trigger (Background)
      if (ContextManager.needsSummarization(fullHistory, contextLimit)) {
        // Fire and forget summarization for the next turn
        ContextManager.summarize(this.memory, storageId, this.provider, fullHistory).catch((e) =>
          logger.error('Background summarization failed:', e)
        );
      }

      // 5. Execution Loop
      const executor = new AgentExecutor(
        this.provider,
        this.tools,
        this.config?.id ?? 'unknown',
        this.config?.name ?? 'SuperClaw'
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
      } = await executor.runLoop(messages, {
        activeModel,
        activeProvider,
        activeProfile,
        maxIterations,
        tracer,
        context,
        traceId,
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
      });

      let responseText = initialResponseText;

      if (paused) {
        await this.memory.addMessage(storageId, {
          role: MessageRole.ASSISTANT,
          content: responseText,
          agentName: this.config?.name ?? 'SuperClaw',
          traceId,
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
        return { responseText, attachments: resultAttachments, traceId };
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
        attachments: resultAttachments,
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

      return { responseText: responseText, attachments: resultAttachments, traceId };
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
}
