import { TraceSource, TaskEvent, Attachment, AgentType, AgentPayload } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  extractBaseUserId,
  detectFailure,
  isTaskPaused,
  validatePayload,
  buildProcessOptions,
  initAgent,
} from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import { SessionStateManager } from '../lib/session/session-state';
import {
  pushRecursionEntry,
  clearRecursionStack,
  getRecursionDepth,
} from '../lib/recursion-tracker';

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

  // Extract agentId from the event source or detail-type
  // Pattern: dynamic_<agentId>_task
  const detailType = event['detail-type'] || '';

  if (!detailType.startsWith('dynamic_')) {
    logger.info('Skipping non-dynamic event in Agent Runner:', detailType);
    return;
  }

  const agentId = detailType.replace('dynamic_', '').replace('_task', '');
  const payload = extractPayload<TaskEvent>(event.detail);
  const { userId, task, isContinuation, traceId, taskId, sessionId } = payload;

  if (!validatePayload({ userId, task }, ['userId', 'task'])) {
    return;
  }

  const baseUserId = extractBaseUserId(userId);

  // Session lock management
  const sessionStateManager = new SessionStateManager();
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  let lockAcquired = false;

  if (sessionId && agentId) {
    lockAcquired = await sessionStateManager.acquireProcessing(sessionId, agentId);

    if (!lockAcquired) {
      logger.info(`[AgentRunner] Session ${sessionId} busy. Queueing task for ${agentId}.`);
      await sessionStateManager.addPendingMessage(sessionId, `${agentId}: ${task}`, []);
      return 'QUEUED';
    }

    heartbeatInterval = setInterval(async () => {
      try {
        const renewed = await sessionStateManager.renewProcessing(sessionId, agentId);
        if (!renewed) {
          logger.warn(`[AgentRunner] Failed to renew lock for ${sessionId}.`);
        }
      } catch (err) {
        logger.error(`[AgentRunner] Heartbeat error for ${sessionId}:`, err);
      }
    }, 60000);
  }

  const MAX_RECURSION_LIMIT = 10;
  if (traceId) {
    const currentDepth = await getRecursionDepth(traceId);
    if (currentDepth >= MAX_RECURSION_LIMIT) {
      logger.error(
        `[AgentRunner] Recursion limit exceeded for trace ${traceId} at depth ${currentDepth}`
      );
      if (lockAcquired && sessionId) {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        await sessionStateManager.releaseProcessing(sessionId, agentId);
      }
      return `Error: Recursion limit exceeded for trace ${traceId}`;
    }
    await pushRecursionEntry(traceId, (payload.depth ?? 0) + 1, sessionId || 'unknown', agentId);
  }

  try {
    // 1. Discovery & Initialization (config + context loaded in parallel)
    const { config, agent } = await initAgent(agentId);

    const isSocial = config?.category === 'social';
    const isTextMode = config?.defaultCommunicationMode === 'text';
    const shouldSpeakDirectly = isSocial || isTextMode;

    // 2. Build Process Options (context, streaming, communication mode)
    const processOptions = buildProcessOptions({
      isContinuation,
      isIsolated: true,
      initiatorId: payload.initiatorId,
      depth: (payload.depth ?? 0) + 1,
      traceId,
      taskId,
      sessionId,
      source: TraceSource.SYSTEM,
      context,
      communicationMode: config?.defaultCommunicationMode,
    });

    // 3. Execution & Streaming
    let finalResponseText = '';
    let finalAttachments: Attachment[] | undefined = undefined;
    const isValidAttachment = (rawAtt: unknown): rawAtt is Attachment => {
      if (!rawAtt || typeof rawAtt !== 'object') return false;
      const a = rawAtt as Record<string, unknown>;
      if (typeof a.url === 'string' && a.url.length > 0) return true;
      if (typeof a.base64 === 'string' && a.base64.length > 0) return true;
      return false;
    };

    if (shouldSpeakDirectly) {
      logger.info(`Agent Runner [${agentId}] starting stream for direct communication...`);
      const stream = agent.stream(userId, task, processOptions);

      for await (const chunk of stream) {
        if (chunk.content) {
          finalResponseText += chunk.content;
        }
        if (chunk.attachments && Array.isArray(chunk.attachments)) {
          finalAttachments = finalAttachments ?? [];
          for (const rawAtt of chunk.attachments) {
            if (isValidAttachment(rawAtt)) finalAttachments.push(rawAtt as Attachment);
            else logger.warn('[AGENT_RUNNER] Skipping invalid chunk attachment');
          }
        }
      }
    } else {
      const processResult = await agent.process(userId, task, processOptions);
      finalResponseText = processResult.responseText;
      if (processResult.attachments && Array.isArray(processResult.attachments)) {
        finalAttachments = [];
        for (const rawAtt of processResult.attachments) {
          if (isValidAttachment(rawAtt)) finalAttachments.push(rawAtt as Attachment);
          else logger.warn('[AGENT_RUNNER] Skipping invalid processResult attachment');
        }
      } else {
        finalAttachments = processResult.attachments;
      }
    }

    // 4. Swarm Self-Organization: Decompose high-level plans into parallel sub-tasks
    const { handleSwarmDecomposition } = await import('../lib/agent/swarm-orchestrator');

    const { wasDecomposed, isPaused, response } = await handleSwarmDecomposition(
      finalResponseText,
      payload as AgentPayload,
      {
        traceId: traceId || `plan-${Date.now()}`,
        sessionId,
        depth: payload.depth,
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

    if (wasDecomposed) {
      logger.info(`[AgentRunner] Plan from ${agentId} successfully decomposed into swarm tasks.`);
      finalResponseText = response || finalResponseText;

      // Emit the notification of decomposition
      await emitTaskEvent({
        source: `${agentId}.runner`,
        agentId: agentId as AgentType,
        userId: baseUserId,
        task,
        response: finalResponseText,
        traceId,
        taskId,
        sessionId,
        initiatorId: payload.initiatorId,
        depth: payload.depth,
        userNotified: true,
      });
    }

    if (isPaused) {
      logger.info(`[AgentRunner] Task ${taskId} is paused, stopping chain.`);
      return finalResponseText;
    }

    logger.info(`Agent Runner [${agentId}] completed task:`, finalResponseText);

    // 4. Notification
    if (!isTaskPaused(finalResponseText)) {
      const isFailure = detectFailure(finalResponseText);

      if (shouldSpeakDirectly && !isFailure) {
        logger.info(
          `Agent Runner [${agentId}] streaming completed, skipping duplicate final outbound message.`
        );
      }

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
        depth: payload.depth,
        userNotified: shouldSpeakDirectly && !isFailure,
        idempotencyKey: traceId,
      });
    }

    return finalResponseText;
  } finally {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (lockAcquired && sessionId && agentId) {
      await sessionStateManager.releaseProcessing(sessionId, agentId);
    }
    if (traceId) {
      await clearRecursionStack(traceId);
    }
  }
}
