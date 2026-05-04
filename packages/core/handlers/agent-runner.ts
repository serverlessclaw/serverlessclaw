import {
  TraceSource,
  TaskEvent,
  Attachment,
  AgentRole,
  AgentPayload,
  isValidAttachment,
} from '../lib/types/agent';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  extractBaseUserId,
  isE2ETest,
  detectFailure,
  isTaskPaused,
  validatePayload,
  buildProcessOptions,
  initAgent,
} from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import { SessionStateManager } from '../lib/session/session-state';
import { isMissionContext } from './events/shared';

interface WorkerEvent {
  'detail-type': string;
  detail: TaskEvent;
}

/**
 * Agent Runner handler. Dynamically loads agent configurations and executes tasks.
 *
 * @param event - The event containing agentId, userId, and task details.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to the worker's response string, or undefined on error.
 */
export async function handler(event: WorkerEvent, context: Context): Promise<string | undefined> {
  logger.info('Agent Runner received event:', JSON.stringify(event, null, 2));

  const detailType = event['detail-type'] || '';

  if (!detailType.startsWith('dynamic_')) {
    logger.info('Skipping non-dynamic event in Agent Runner:', detailType);
    return;
  }

  const agentId = detailType.replace('dynamic_', '').replace('_task', '');
  const payload = extractPayload<TaskEvent>(event.detail);
  const {
    userId,
    task,
    isContinuation,
    traceId,
    taskId,
    sessionId,
    workspaceId,
    teamId,
    staffId,
    userRole,
  } = payload;

  if (!validatePayload({ userId, task }, ['userId', 'task'])) {
    return;
  }
  const baseUserId = extractBaseUserId(userId);

  // Authorize User
  try {
    if (baseUserId && baseUserId !== 'SYSTEM' && baseUserId !== 'dashboard-user' && !isE2ETest()) {
      const { getIdentityManager, Permission } = await import('../lib/session/identity');
      const identityManager = await getIdentityManager();
      const hasPermission = await identityManager.hasPermission(
        baseUserId,
        Permission.TASK_CREATE,
        workspaceId
      );
      if (!hasPermission) {
        logger.warn(
          `[AgentRunner] Access denied. User ${baseUserId} lacks TASK_CREATE permission.`
        );
        return `Error: Unauthorized to create tasks in this workspace`;
      }
    }
  } catch (error) {
    logger.error(`[AgentRunner] Permission check failed:`, error);
    return `Error: Permission check failed`;
  }

  // Session lock management
  const sessionStateManager = new SessionStateManager();
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  let lockAcquired = false;
  const abortController = new AbortController();
  const HEARTBEAT_INTERVAL_MS = 60000; // Simplified fixed heartbeat (60s)

  if (sessionId && agentId) {
    lockAcquired = await sessionStateManager.acquireProcessing(sessionId, agentId, {
      workspaceId,
      teamId,
      staffId,
    });

    if (!lockAcquired) {
      logger.info(`[AgentRunner] Session ${sessionId} busy. Queueing task for ${agentId}.`);
      await sessionStateManager.addPendingMessage(sessionId, `${agentId}: ${task}`, []);
      return 'QUEUED';
    }

    const runHeartbeat = async () => {
      try {
        if (!lockAcquired) return;
        const renewed = await sessionStateManager.renewProcessing(sessionId, agentId, {
          workspaceId,
          teamId,
          staffId,
        });
        if (!renewed) {
          logger.warn(`[AgentRunner] Failed to renew lock for ${sessionId}. Lock lost.`);
          lockAcquired = false;
          abortController.abort(new Error('LockLostError: Session lock was lost or expired.'));
        }
      } catch (err) {
        logger.error(`[AgentRunner] Heartbeat error for ${sessionId}:`, err);
      }
    };

    heartbeatInterval = setInterval(runHeartbeat, HEARTBEAT_INTERVAL_MS);
  }

  // Perform recursion depth check and atomic increment
  const { checkAndPushRecursion } = await import('./events/shared');
  const isMission = isMissionContext(detailType, payload.metadata as Record<string, unknown>);
  const currentDepth = await checkAndPushRecursion(
    traceId || 'unknown',
    sessionId || 'unknown',
    agentId,
    { isMissionContext: isMission, workspaceId }
  );

  if (currentDepth === null) {
    if (lockAcquired && sessionId) {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      await sessionStateManager.releaseProcessing(sessionId, agentId, {
        workspaceId,
        teamId,
        staffId,
      });
    }
    return `Error: Recursion limit exceeded for trace ${traceId}`;
  }

  try {
    // 1. Discovery & Initialization
    // Selection Integrity (Principle 14): Verify agent is enabled before initialization
    const { AgentRegistry } = await import('../lib/registry/AgentRegistry');
    const agentConfig = await AgentRegistry.getAgentConfig(agentId, {
      workspaceId,
    });
    if (!agentConfig) {
      logger.warn(`[AgentRunner] Agent ${agentId} not found in registry.`);
      return `Error: Agent ${agentId} not found`;
    }
    if (agentConfig.enabled !== true) {
      logger.warn(
        `[AgentRunner] Selection Integrity check failed: Agent ${agentId} is disabled (enabled=${agentConfig.enabled}).`
      );
      return `Error: Agent ${agentId} is disabled`;
    }

    const { config, agent } = await initAgent(agentId, { workspaceId });
    const shouldSpeakDirectly =
      config?.category === 'social' || config?.defaultCommunicationMode === 'text';

    // Anti-Pattern 10 Fix: Enforce JSON communication when initiator is another agent
    const communicationMode = payload.initiatorId ? 'json' : config?.defaultCommunicationMode;

    // 2. Build Process Options
    const processOptions = buildProcessOptions({
      isContinuation,
      isIsolated: true,
      initiatorId: payload.initiatorId,
      depth: currentDepth,
      traceId,
      taskId,
      sessionId,
      workspaceId,
      teamId,
      staffId,
      userRole: userRole as import('../lib/types/agent').UserRole,
      source: TraceSource.SYSTEM,
      context,
      communicationMode,
      abortSignal: abortController.signal,
    });

    // 3. Execution & Streaming
    let finalResponseText = '';
    let finalAttachments: Attachment[] | undefined = undefined;

    const collectAttachments = (attachments: unknown[]): Attachment[] => {
      return (attachments as Attachment[]).filter((a) => isValidAttachment(a));
    };

    if (shouldSpeakDirectly) {
      logger.info(`Agent Runner [${agentId}] starting stream for direct communication...`);
      const stream = agent.stream(userId, task, processOptions);

      for await (const chunk of stream) {
        if (chunk.content) finalResponseText += chunk.content;
        if (chunk.attachments && Array.isArray(chunk.attachments)) {
          const valid = collectAttachments(chunk.attachments);
          finalAttachments = ((finalAttachments || []) as Attachment[]).concat(valid);
        }
      }
    } else {
      const processResult = await agent.process(userId, task, processOptions);
      finalResponseText = processResult.responseText;
      if (processResult.attachments && Array.isArray(processResult.attachments)) {
        finalAttachments = collectAttachments(processResult.attachments);
      }
    }

    // 4. Swarm Self-Organization: Decompose high-level plans into parallel sub-tasks
    const { handleSwarmDecomposition } = await import('../lib/agent/swarm-orchestrator');
    let wasDecomposed = false;
    let isPaused = false;

    try {
      const decompositionResult = await handleSwarmDecomposition(
        finalResponseText,
        payload as AgentPayload,
        {
          traceId: traceId || `plan-${Date.now()}`,
          sessionId,
          depth: currentDepth,
          isContinuation,
          sourceAgentId: agentId,
          lockedGapIds: payload.metadata?.gapIds as string[],
          barrierTimeoutMs: 15 * 60 * 1000,
          aggregationType: 'agent_guided',
          aggregationPrompt: `I have completed the parallel execution of the mission: "${finalResponseText.substring(0, 200)}...". 
                             Please synthesize the results and provide a final summary.
                             Prepend the result with [AGGREGATED_RESULTS].`,
        }
      );
      wasDecomposed = decompositionResult.wasDecomposed;
      isPaused = decompositionResult.isPaused;
      if (wasDecomposed) finalResponseText = decompositionResult.response;
    } catch (decompositionError) {
      logger.error(`[AgentRunner] Swarm decomposition failed for ${agentId}:`, decompositionError);
    }

    if (isPaused || isTaskPaused(finalResponseText)) {
      logger.info(
        `[AgentRunner] Task ${taskId} is paused (decomposed: ${wasDecomposed}), stopping chain.`
      );
      // If decomposed, we already emitted parallel events, but we still emit a completion event for the planner
      if (wasDecomposed) {
        await emitTaskEvent({
          source: `${agentId}.runner`,
          agentId: agentId as AgentRole,
          userId: baseUserId,
          task,
          response: finalResponseText,
          traceId,
          taskId,
          sessionId,
          initiatorId: payload.initiatorId,
          depth: currentDepth,
          userNotified: true,
        });
      }
      return finalResponseText;
    }

    logger.info(`Agent Runner [${agentId}] completed task:`, finalResponseText);

    // 5. Final Notification
    const isFailure = detectFailure(finalResponseText);
    await emitTaskEvent({
      source: `${agentId}.agent`,
      agentId,
      userId: baseUserId,
      task,
      [isFailure ? 'error' : 'response']: finalResponseText,
      attachments: finalAttachments,
      traceId,
      taskId,
      sessionId,
      initiatorId: payload.initiatorId,
      depth: currentDepth,
      userNotified: shouldSpeakDirectly && !isFailure,
      idempotencyKey: taskId || `${traceId}-${agentId}`,
      workspaceId,
      teamId,
      staffId,
      userRole,
    });

    return finalResponseText;
  } finally {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (lockAcquired && sessionId && agentId) {
      await sessionStateManager.releaseProcessing(sessionId, agentId, {
        workspaceId,
        teamId,
        staffId,
      });
    }
  }
}
