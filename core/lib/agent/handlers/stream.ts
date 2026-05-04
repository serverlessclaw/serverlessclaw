import {
  IMemory,
  IProvider,
  ITool,
  MessageRole,
  IAgentConfig,
  TraceSource,
  Attachment,
  MessageChunk,
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

export async function* handleStream(
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
    communicationMode = agent.config?.defaultCommunicationMode ??
      (options.initiatorId ? 'json' : 'text'),
  } = options;

  const scope = { workspaceId, orgId, teamId, staffId };
  const startTime = Date.now();

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
  if (baseUserId && baseUserId !== 'SYSTEM' && baseUserId !== 'dashboard-user' && !isE2ETest()) {
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

  const { isHumanTakingControl } = await import('../../handoff');
  const ignoreHandoff = options.ignoreHandoff ?? false;
  if (!ignoreHandoff && (await isHumanTakingControl(baseUserId, sessionId))) {
    yield {
      content: TRACE_MESSAGES.OBSERVE_MODE,
      thought: undefined,
      messageId: `msg-handoff-${Date.now()}`,
    };
    await tracer.endTrace(TRACE_MESSAGES.OBSERVE_MODE);
    return;
  }

  if (!options.skipUserSave) {
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

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let fullContent = '';
  let fullThought = '';

  let totalToolCalls = 0;

  try {
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

    const stream = executor.streamLoop(messages, {
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
      responseFormat:
        communicationMode === COMMUNICATION_MODES.JSON
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
        if (chunk.usage.tool_calls) totalToolCalls += chunk.usage.tool_calls;
      }
      yield chunk;
    }

    if (!process.env.VITEST) {
      await reportAgentMetrics({
        agentId: agent.config?.id ?? 'unknown',
        traceId,
        activeProvider: finalProvider ?? 'unknown',
        activeModel: finalModel ?? 'unknown',
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        toolCalls: totalToolCalls,
        durationMs: Date.now() - startTime,
        success: true,
        paused: false,
        scope,
      });
    }

    if (!isIsolated) {
      const assistantMessageId = `${traceId}-${agent.config?.id ?? 'assistant'}`;
      await agent.memory.addMessage(
        storageId,
        {
          role: MessageRole.ASSISTANT,
          content: fullContent,
          thought: fullThought,
          agentName: agent.config?.name ?? AGENT_SYSTEM_IDS.SUPERCLAW,
          traceId,
          messageId: assistantMessageId,
          modelName: finalModel ?? AGENT_SYSTEM_IDS.UNKNOWN,
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

    if (!process.env.VITEST) {
      reportAgentMetrics({
        agentId: agent.config?.id ?? 'unknown',
        traceId,
        activeProvider: 'unknown',
        activeModel: 'unknown',
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        toolCalls: totalToolCalls,
        durationMs: Date.now() - startTime,
        success: false,
        paused: false,
        scope,
      }).catch(() => {});
    }

    throw error;
  }
}
