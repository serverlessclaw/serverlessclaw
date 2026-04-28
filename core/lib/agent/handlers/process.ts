import {
  IMemory,
  IProvider,
  ITool,
  MessageRole,
  IAgentConfig,
  TraceSource,
  Attachment,
} from '../../types/index';
import { logger } from '../../logger';
import { AgentProcessOptions } from '../options';
import { AgentEmitter } from '../emitter';
import { DEFAULT_SIGNAL_SCHEMA } from '../schema';
import { initializeTracer } from '../tracer-init';
import { resolveAgentConfig } from '../config-resolver';
import { reportAgentMetrics } from '../metrics-helper';
import { isE2ETest } from '../../utils/agent-helpers';
import { AGENT_SYSTEM_IDS, COMMUNICATION_MODES, TRACE_MESSAGES } from '../../constants/agent';

/**
 * Main handler for processing a user request through an agent.
 * Manages tracer initialization, history retrieval, context preparation, and execution loop.
 *
 * @param agent - The agent instance providing subsystems.
 * @param userId - The user ID or session ID initiating the request.
 * @param userText - The raw input text from the user.
 * @param options - Optional processing parameters.
 */
export async function handleProcess(
  agent: {
    memory: IMemory;
    provider: IProvider;
    tools: ITool[];
    config?: IAgentConfig;
    emitter: AgentEmitter;
  },
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
    communicationMode = agent.config?.defaultCommunicationMode ?? 'text',
    taskTimeoutMs,
    priorTokenUsage,
    skipUserSave = false,
  } = options;

  const responseFormat =
    communicationMode === COMMUNICATION_MODES.JSON
      ? initialResponseFormat || DEFAULT_SIGNAL_SCHEMA
      : initialResponseFormat;

  const scope = { workspaceId, orgId, teamId, staffId };

  const { tracer, traceId, baseUserId } = await initializeTracer(userId, source, {
    incomingTraceId,
    incomingNodeId,
    incomingParentId,
    agentId: agent.config?.id,
    isContinuation: options.isContinuation,
    userText,
    sessionId,
    hasAttachments: !!incomingAttachments,
    scope,
  });

  const effectiveTaskId = taskId ?? traceId;
  const nodeId = tracer.getNodeId();
  const parentId = tracer.getParentId();
  const currentInitiator = options.initiatorId ?? agent.config?.id ?? AGENT_SYSTEM_IDS.ORCHESTRATOR;

  const storageId = isIsolated
    ? `${(agent.config?.id ?? AGENT_SYSTEM_IDS.UNKNOWN).toUpperCase()}#${userId}#${traceId}`
    : userId;

  let userRole: import('../../../lib/types/agent').UserRole | undefined = initialUserRole;

  // Authorization check
  if (
    baseUserId &&
    baseUserId !== AGENT_SYSTEM_IDS.SYSTEM &&
    baseUserId !== AGENT_SYSTEM_IDS.DASHBOARD_USER &&
    !isE2ETest()
  ) {
    try {
      const { getIdentityManager, Permission } = await import('../../session/identity');
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
  const { isBudgetExceeded } = await import('../../recursion-tracker');
  if (await isBudgetExceeded(traceId)) {
    const responseText = TRACE_MESSAGES.BUDGET_EXCEEDED(traceId);
    await tracer.endTrace(responseText);
    return { responseText, traceId };
  }

  const { isHumanTakingControl } = await import('../../handoff');
  const ignoreHandoff = options.ignoreHandoff ?? false;
  if (!ignoreHandoff && (await isHumanTakingControl(baseUserId, sessionId))) {
    const responseText = TRACE_MESSAGES.OBSERVE_MODE;
    await tracer.endTrace(responseText);
    return { responseText, traceId };
  }

  import('../warmup')
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
    await agent.memory.addMessage(
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
    } = await resolveAgentConfig(agent.config, profile);

    // Fetch global budgets if not explicitly provided in options
    const { ConfigManager } = await import('../../registry/config');
    const { CONFIG_KEYS } = await import('../../constants');

    const sessionTokenBudget =
      options.tokenBudget ??
      (await ConfigManager.getTypedConfig<number>(CONFIG_KEYS.SESSION_TOKEN_BUDGET, 0));
    const sessionCostLimit =
      options.costLimit ??
      (await ConfigManager.getTypedConfig<number>(CONFIG_KEYS.SESSION_COST_LIMIT, 0));

    const { AgentAssembler } = await import('../assembler');
    const {
      contextPrompt,
      messages,
      summary,
      contextLimit,
      activeModel: finalModel,
      activeProvider: finalProvider,
    } = await AgentAssembler.prepareContext(
      agent.memory,
      agent.provider,
      agent.config,
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
        systemPrompt: agent.config?.systemPrompt ?? '',
        pageContext: options.pageContext,
        agentId: agent.config?.id,
        workspaceId,
        orgId,
        teamId,
        staffId,
      }
    );

    const { AgentExecutor, AGENT_DEFAULTS } = await import('../executor');
    const executor = new AgentExecutor(
      agent.provider,
      agent.tools,
      agent.config?.id ?? 'unknown',
      agent.config?.name ?? 'SuperClaw',
      contextPrompt,
      summary,
      contextLimit,
      agent.config
    );

    const loopUsage = {
      totalInputTokens: priorTokenUsage?.inputTokens ?? 0,
      totalOutputTokens: priorTokenUsage?.outputTokens ?? 0,
      total_tokens: priorTokenUsage?.totalTokens ?? 0,
      toolCallCount: 0,
      durationMs: 0,
    };

    const result = await executor.runLoop(messages, {
      maxIterations: agent.config?.maxIterations ?? AGENT_DEFAULTS.MAX_ITERATIONS,
      tracer,
      emitter: agent.emitter,
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
        await agent.memory.addMessage(storageId, messageToSave, scope);
      } else if (paused) {
        await agent.memory.addMessage(
          storageId,
          {
            role: MessageRole.ASSISTANT,
            content: responseText,
            thought: finalThought,
            agentName: agent.config?.name ?? AGENT_SYSTEM_IDS.SUPERCLAW,
            traceId,
            messageId: `msg-assistant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          },
          scope
        );
      } else {
        await agent.memory.addMessage(
          storageId,
          {
            role: MessageRole.ASSISTANT,
            content: responseText,
            thought: finalThought,
            agentName: agent.config?.name ?? AGENT_SYSTEM_IDS.SUPERCLAW,
            traceId,
            messageId: `msg-assistant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          },
          scope
        );
      }
    }

    if (!process.env.VITEST) {
      await reportAgentMetrics({
        agentId: agent.config?.id ?? AGENT_SYSTEM_IDS.UNKNOWN,
        traceId,
        activeProvider: finalProvider ?? AGENT_SYSTEM_IDS.UNKNOWN,
        activeModel: finalModel ?? AGENT_SYSTEM_IDS.UNKNOWN,
        inputTokens: loopUsage.totalInputTokens,
        outputTokens: loopUsage.totalOutputTokens,
        toolCalls: loopUsage.toolCallCount,
        durationMs: loopUsage.durationMs,
        success: !paused,
        paused: !!paused,
        scope,
      });
    }

    await tracer.endTrace(responseText);

    return { responseText, traceId, attachments, thought: finalThought };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[AGENT] Process Error: ${errorMessage}`, { agentId: agent.config?.id, traceId });
    await tracer.failTrace(errorMessage, { error: errorMessage });
    throw error;
  }
}
