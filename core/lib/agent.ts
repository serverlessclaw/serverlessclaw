import {
  IMemory,
  IProvider,
  ITool,
  MessageRole,
  IAgentConfig,
  TraceSource,
  Attachment,
  MessageChunk,
} from './types/index';
import { logger } from './logger';
import { AgentProcessOptions } from './agent/options';
import { AgentEmitter } from './agent/emitter';
import { DEFAULT_SIGNAL_SCHEMA } from './agent/schema';
import { initializeTracer } from './agent/tracer-init';
import { resolveAgentConfig } from './agent/config-resolver';
import { validateAgentConfig } from './agent/validator';
import { reportAgentMetrics } from './agent/metrics-helper';
import { isE2ETest } from './utils/agent-helpers';

// Re-export validation for backward compatibility and tests
export { validateAgentConfig };

/**
 * Main Agent Class
 */
export class Agent {
  protected memory: IMemory;
  protected provider: IProvider;
  protected tools: ITool[];
  protected config?: IAgentConfig;
  protected emitter: AgentEmitter;

  constructor(memory: IMemory, provider: IProvider, tools: ITool[], config?: IAgentConfig) {
    this.memory = memory;
    this.provider = provider;
    this.tools = tools;
    this.config = config;
    this.emitter = new AgentEmitter(config);
  }

  /**
   * Returns the agent's configuration.
   */
  public getConfig(): IAgentConfig | undefined {
    return this.config;
  }

  /**
   * Processes a user message and returns the final response.
   */
  async process(
    userId: string,
    userText: string,
    options: AgentProcessOptions = {}
  ): Promise<{
    responseText: string;
    traceId: string;
    attachments?: Attachment[];
    thought?: string;
  }> {
    const {
      isIsolated = false,
      profile,
      traceId: incomingTraceId,
      nodeId: incomingNodeId,
      parentId: incomingParentId,
      taskId,
      sessionId,
      workspaceId,
      orgId,
      teamId,
      staffId,
      userRole: initialUserRole,
      attachments: incomingAttachments,
      source = TraceSource.UNKNOWN,
      responseFormat: initialResponseFormat,
      communicationMode = this.config?.defaultCommunicationMode ?? 'text',
      taskTimeoutMs,
      priorTokenUsage,
      skipUserSave = false,
    } = options;

    const responseFormat =
      communicationMode === 'json'
        ? initialResponseFormat || DEFAULT_SIGNAL_SCHEMA
        : initialResponseFormat;

    const scope = { workspaceId, orgId, teamId, staffId };

    const { tracer, traceId, baseUserId } = await initializeTracer(
      userId,
      source,
      incomingTraceId,
      incomingNodeId,
      incomingParentId,
      this.config?.id,
      options.isContinuation,
      userText,
      sessionId,
      !!incomingAttachments,
      scope
    );

    const effectiveTaskId = taskId ?? traceId;
    const nodeId = tracer.getNodeId();
    const parentId = tracer.getParentId();
    const currentInitiator = options.initiatorId ?? this.config?.id ?? 'orchestrator';

    const storageId = isIsolated
      ? `${(this.config?.id ?? 'unknown').toUpperCase()}#${userId}#${traceId}`
      : userId;

    let userRole: import('./types/agent').UserRole | undefined = initialUserRole;

    // Authorization check
    if (baseUserId && baseUserId !== 'SYSTEM' && baseUserId !== 'dashboard-user' && !isE2ETest()) {
      try {
        const { getIdentityManager, Permission } = await import('./session/identity');
        const identityManager = await getIdentityManager();

        const identity = await identityManager.getUser(baseUserId);
        if (identity) {
          userRole = identity.role;
        }

        const hasPermission = await identityManager.hasPermission(
          baseUserId,
          Permission.TASK_CREATE,
          workspaceId
        );
        if (!hasPermission) {
          const errorMsg = `[Agent] Access denied. User ${baseUserId} lacks TASK_CREATE permission.`;
          logger.warn(errorMsg);
          await tracer.failTrace(errorMsg);
          return { responseText: `Error: Unauthorized to create tasks`, traceId };
        }
      } catch (error) {
        logger.error(`[Agent] Permission check failed:`, error);
        await tracer.failTrace('Permission check failed');
        return { responseText: `Error: Permission check failed`, traceId };
      }
    }

    // Early exit if global trace budget is already exceeded
    const { isBudgetExceeded } = await import('./recursion-tracker');
    if (await isBudgetExceeded(traceId)) {
      const responseText = `[BUDGET_EXCEEDED] Global execution budget for trace ${traceId} has been reached. Halting further processing.`;
      await tracer.endTrace(responseText);
      return { responseText, traceId };
    }

    const { isHumanTakingControl } = await import('./handoff');
    const ignoreHandoff = options.ignoreHandoff ?? false;
    if (!ignoreHandoff && (await isHumanTakingControl(baseUserId, sessionId))) {
      const responseText = 'HUMAN_TAKING_CONTROL: Entering observe mode.';
      await tracer.endTrace(responseText);
      return { responseText, traceId };
    }

    import('./agent/warmup')
      .then(({ triggerSmartWarmup }) => {
        triggerSmartWarmup(
          userText,
          options.depth ?? 0,
          sessionId,
          options.sessionStateManager,
          workspaceId
        );
      })
      .catch(() => {});

    if (!skipUserSave) {
      await this.memory.addMessage(
        storageId,
        {
          role: MessageRole.USER,
          content: userText,
          attachments: incomingAttachments as Attachment[],
          traceId,
          messageId: `msg-user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        },
        scope
      );
    }

    try {
      const startTime = Date.now();
      const {
        activeModel: resolvedModel,
        activeProvider: resolvedProvider,
        activeProfile: resolvedProfile,
      } = await resolveAgentConfig(this.config, profile);

      // Fetch global budgets if not explicitly provided in options
      const { ConfigManager } = await import('./registry/config');
      const { CONFIG_KEYS } = await import('./constants');

      const sessionTokenBudget =
        options.tokenBudget ??
        (await ConfigManager.getTypedConfig<number>(CONFIG_KEYS.SESSION_TOKEN_BUDGET, 0));
      const sessionCostLimit =
        options.costLimit ??
        (await ConfigManager.getTypedConfig<number>(CONFIG_KEYS.SESSION_COST_LIMIT, 0));

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
        incomingAttachments as Attachment[],
        {
          isIsolated,
          depth: options.depth ?? 0,
          activeModel: resolvedModel,
          activeProvider: resolvedProvider,
          activeProfile: resolvedProfile,
          systemPrompt: this.config?.systemPrompt ?? '',
          pageContext: options.pageContext,
          agentId: this.config?.id,
          workspaceId,
          orgId,
          teamId,
          staffId,
        }
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

      const loopUsage = {
        totalInputTokens: priorTokenUsage?.inputTokens ?? 0,
        totalOutputTokens: priorTokenUsage?.outputTokens ?? 0,
        total_tokens: priorTokenUsage?.totalTokens ?? 0,
        toolCallCount: 0,
        durationMs: 0,
      };

      const result = await executor.runLoop(messages, {
        maxIterations: this.config?.maxIterations ?? AGENT_DEFAULTS.MAX_ITERATIONS,
        tracer,
        emitter: this.emitter,
        context: options.context,
        traceId,
        taskId: effectiveTaskId,
        nodeId,
        parentId,
        sessionId,
        workspaceId,
        teamId,
        staffId,
        userId: baseUserId,
        userRole,
        metadata: options.metadata,
        mainConversationId: storageId,
        activeModel: finalModel,
        activeProvider: finalProvider,
        activeProfile: resolvedProfile,
        userText,
        responseFormat,
        taskTimeoutMs,
        approvedToolCalls: options.approvedToolCalls,
        currentInitiator,
        depth: options.depth ?? 0,
        tokenBudget: sessionTokenBudget || undefined,
        costLimit: sessionCostLimit || undefined,
      });

      loopUsage.totalInputTokens += result.usage?.totalInputTokens ?? 0;
      loopUsage.totalOutputTokens += result.usage?.totalOutputTokens ?? 0;
      loopUsage.total_tokens = loopUsage.totalInputTokens + loopUsage.totalOutputTokens;
      loopUsage.toolCallCount = result.usage?.toolCallCount ?? 0;
      loopUsage.durationMs = Date.now() - startTime;

      const { responseText: rawResponseText, attachments = [], paused } = result;

      let finalThought: string | undefined;
      let responseText = rawResponseText;
      let extractedContent = responseText;
      if (communicationMode === 'json' && rawResponseText) {
        try {
          const parsed = JSON.parse(responseText);
          finalThought = parsed.thought || parsed.reasoning || parsed.thinking;
          const extractedText = parsed.message || parsed.plan;
          if (extractedText) {
            responseText = extractedText;
            extractedContent = extractedText;
          }
        } catch {
          // Fallback to raw text if not valid JSON
        }
      }

      if (!isIsolated) {
        if (result.lastAiResponse) {
          const messageToSave =
            extractedContent !== rawResponseText
              ? { ...result.lastAiResponse, content: extractedContent, thought: finalThought }
              : result.lastAiResponse;
          await this.memory.addMessage(storageId, messageToSave, scope);
        } else if (paused) {
          await this.memory.addMessage(
            storageId,
            {
              role: MessageRole.ASSISTANT,
              content: responseText,
              thought: finalThought,
              agentName: this.config?.name ?? 'Agent',
              traceId,
              messageId: `msg-assistant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            },
            scope
          );
        } else {
          await this.memory.addMessage(
            storageId,
            {
              role: MessageRole.ASSISTANT,
              content: responseText,
              thought: finalThought,
              agentName: this.config?.name ?? 'Agent',
              traceId,
              messageId: `msg-assistant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            },
            scope
          );
        }
      }

      return { responseText, traceId, attachments, thought: finalThought };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[AGENT] Process Error: ${errorMessage}`, { agentId: this.config?.id, traceId });
      await tracer.failTrace(errorMessage, { error: errorMessage });
      throw error;
    }
  }

  /**
   * Streaming version of process().
   */
  async *stream(
    userId: string,
    userText: string,
    options: AgentProcessOptions = {}
  ): AsyncGenerator<MessageChunk> {
    const {
      isIsolated = false,
      profile,
      traceId: incomingTraceId,
      nodeId: incomingNodeId,
      parentId: incomingParentId,
      taskId,
      sessionId,
      workspaceId,
      orgId,
      teamId,
      staffId,
      userRole: initialUserRole,
      attachments: incomingAttachments,
      source = TraceSource.UNKNOWN,
      responseFormat: initialResponseFormat,
      communicationMode = this.config?.defaultCommunicationMode ?? 'text',
    } = options;

    const scope = { workspaceId, orgId, teamId, staffId };
    const startTime = Date.now();

    const { tracer, traceId, baseUserId } = await initializeTracer(
      userId,
      source,
      incomingTraceId,
      incomingNodeId,
      incomingParentId,
      this.config?.id,
      options.isContinuation,
      userText,
      sessionId,
      !!incomingAttachments,
      scope
    );

    const effectiveTaskId = taskId ?? traceId;
    const nodeId = tracer.getNodeId();
    const parentId = tracer.getParentId();
    const currentInitiator = options.initiatorId ?? this.config?.id ?? 'orchestrator';

    const storageId = isIsolated
      ? `${(this.config?.id ?? 'unknown').toUpperCase()}#${userId}#${traceId}`
      : userId;

    let userRole: import('./types/agent').UserRole | undefined = initialUserRole;

    // Authorization check
    if (baseUserId && baseUserId !== 'SYSTEM' && baseUserId !== 'dashboard-user' && !isE2ETest()) {
      try {
        const { getIdentityManager, Permission } = await import('./session/identity');
        const identityManager = await getIdentityManager();

        const identity = await identityManager.getUser(baseUserId);
        if (identity) {
          userRole = identity.role;
        }

        const hasPermission = await identityManager.hasPermission(
          baseUserId,
          Permission.TASK_CREATE,
          workspaceId
        );
        if (!hasPermission) {
          const errorMsg = `[Agent] Access denied. User ${baseUserId} lacks TASK_CREATE permission.`;
          logger.warn(errorMsg);
          await tracer.failTrace(errorMsg);
          yield {
            content: `Error: Unauthorized to create tasks`,
            thought: undefined,
            messageId: `msg-error-${Date.now()}`,
          };
          return;
        }
      } catch (error) {
        logger.error(`[Agent] Permission check failed:`, error);
        await tracer.failTrace('Permission check failed');
        yield {
          content: `Error: Permission check failed`,
          thought: undefined,
          messageId: `msg-error-${Date.now()}`,
        };
        return;
      }
    }

    const { isHumanTakingControl } = await import('./handoff');
    const ignoreHandoff = options.ignoreHandoff ?? false;
    if (!ignoreHandoff && (await isHumanTakingControl(baseUserId, sessionId))) {
      yield {
        content: 'HUMAN_TAKING_CONTROL: Entering observe mode.',
        thought: undefined,
        messageId: `msg-handoff-${Date.now()}`,
      };
      await tracer.endTrace('HUMAN_TAKING_CONTROL: Entering observe mode.');
      return;
    }

    if (!options.skipUserSave) {
      await this.memory.addMessage(
        storageId,
        {
          role: MessageRole.USER,
          content: userText,
          attachments: incomingAttachments as Attachment[],
          traceId,
          messageId: `msg-user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        },
        scope
      );
    }

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let fullContent = '';
    let fullThought = '';

    try {
      const {
        activeModel: resolvedModel,
        activeProvider: resolvedProvider,
        activeProfile: resolvedProfile,
      } = await resolveAgentConfig(this.config, profile);

      // Fetch global budgets if not explicitly provided in options
      const { ConfigManager } = await import('./registry/config');
      const { CONFIG_KEYS } = await import('./constants');

      const sessionTokenBudget =
        options.tokenBudget ??
        (await ConfigManager.getTypedConfig<number>(CONFIG_KEYS.SESSION_TOKEN_BUDGET, 0));
      const sessionCostLimit =
        options.costLimit ??
        (await ConfigManager.getTypedConfig<number>(CONFIG_KEYS.SESSION_COST_LIMIT, 0));

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
        incomingAttachments as Attachment[],
        {
          isIsolated,
          depth: options.depth ?? 0,
          activeModel: resolvedModel,
          activeProvider: resolvedProvider,
          activeProfile: resolvedProfile,
          systemPrompt: this.config?.systemPrompt ?? '',
          pageContext: options.pageContext,
          agentId: this.config?.id,
          workspaceId,
          orgId,
          teamId,
          staffId,
        }
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

      const stream = executor.streamLoop(messages, {
        maxIterations: this.config?.maxIterations ?? AGENT_DEFAULTS.MAX_ITERATIONS,
        tracer,
        emitter: this.emitter,
        context: options.context,
        traceId,
        taskId: effectiveTaskId,
        nodeId,
        parentId,
        sessionId,
        workspaceId,
        teamId,
        staffId,
        userId: baseUserId,
        userRole,
        metadata: options.metadata,
        mainConversationId: storageId,
        activeModel: finalModel,
        activeProvider: finalProvider,
        activeProfile: resolvedProfile,
        userText,
        responseFormat:
          communicationMode === 'json'
            ? initialResponseFormat || DEFAULT_SIGNAL_SCHEMA
            : initialResponseFormat,
        currentInitiator,
        depth: options.depth ?? 0,
        tokenBudget: sessionTokenBudget || undefined,
        costLimit: sessionCostLimit || undefined,
      });

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
        await reportAgentMetrics({
          agentId: this.config?.id ?? 'unknown',
          traceId,
          activeProvider: finalProvider ?? 'unknown',
          activeModel: finalModel ?? 'unknown',
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          toolCalls: 0,
          durationMs: Date.now() - startTime,
          success: true,
          paused: false,
          scope,
        });
      }

      if (!isIsolated) {
        const assistantMessageId = `${traceId}-${this.config?.id ?? 'assistant'}`;
        await this.memory.addMessage(
          storageId,
          {
            role: MessageRole.ASSISTANT,
            content: fullContent,
            thought: fullThought,
            agentName: this.config?.name ?? 'SuperClaw',
            traceId,
            messageId: assistantMessageId,
            modelName: finalModel ?? 'unknown',
            usage: {
              prompt_tokens: totalInputTokens,
              completion_tokens: totalOutputTokens,
              total_tokens: totalInputTokens + totalOutputTokens,
            },
          },
          scope
        );
      }
      await tracer.endTrace(fullContent);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await tracer.failTrace(errorMessage, { error: errorMessage });
      throw error;
    }
  }
}
