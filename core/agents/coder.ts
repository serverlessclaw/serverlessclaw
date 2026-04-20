import { AgentType, AgentEvent, AgentPayload, Attachment, GapStatus } from '../lib/types/agent';
import { Message } from '../lib/types/llm';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  detectFailure,
  isTaskPaused,
  validatePayload,
  extractBaseUserId,
  initAgent,
} from '../lib/utils/agent-helpers';
import { TRACE_TYPES } from '../lib/constants';

/**
 * Coder Agent handler. Processes coding tasks, implements changes,
 * and optionally triggers deployments or notifies QA.
 *
 * @param event - The EventBridge event.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to the agent's response string, or undefined on error.
 */
export const handler = async (event: AgentEvent, context: Context): Promise<string | undefined> => {
  logger.info('Coder Agent received task:', JSON.stringify(event, null, 2));

  // EventBridge wraps the payload in 'detail'
  const payload = extractPayload<AgentPayload>(event);
  const { userId, task, metadata, traceId, sessionId, isContinuation, initiatorId, depth, taskId } =
    payload;
  const gapIds = metadata?.gapIds as string[] | undefined;
  const applyStagedChanges = metadata?.applyStagedChanges as boolean | undefined;

  if (!validatePayload({ userId, task: task || '' }, ['userId', 'task'])) {
    return;
  }

  // 1. Prepare writable /tmp workspace
  const { createWorkspace, cleanupWorkspace } = await import('../lib/utils/workspace-manager');
  const workspacePath = await createWorkspace(
    traceId ?? `unknown-${Date.now()}`,
    applyStagedChanges
  );
  const originalCwd = process.cwd();
  process.chdir(workspacePath);
  logger.info(`[Coder] Working in workspace: ${workspacePath}`);

  const isAggregation = task?.includes('[AGGREGATED_RESULTS]');

  // Swarm Self-Organization: Decompose high-level goals into parallel sub-tasks
  const { handleSwarmDecomposition } = await import('../lib/agent/swarm-orchestrator');
  const { wasDecomposed, response: swarmResponse } = await handleSwarmDecomposition(
    task || '',
    payload,
    {
      traceId,
      sessionId,
      depth,
      isAggregation,
      sourceAgentId: AgentType.CODER,
      lockedGapIds: gapIds || [],
      barrierTimeoutMs: 30 * 60 * 1000, // 30 mins for complex coding tasks
      aggregationType: 'merge_patches',
      aggregationPrompt: `I have completed the parallel implementation for: "${task?.substring(0, 200)}...". 
                         Please merge the resulting patches and synthesize the final outcome.
                         Prepend the response with [AGGREGATED_RESULTS].`,
      minLength: 400,
    }
  );

  if (wasDecomposed) {
    logger.info(`[CODER] Development Goal successfully decomposed into swarm tasks.`);
    process.chdir(originalCwd);
    await cleanupWorkspace(workspacePath);
    return swarmResponse || `[DELEGATED] Task decomposed into parallel sub-tasks for execution.`;
  }

  // 2. Discovery & Initialization
  const { config, memory } = await initAgent(AgentType.CODER);

  // 3. Gap Management - PROGRESS (Phase B2: Atomic Transitions)
  if (gapIds && gapIds.length > 0) {
    for (const gapId of gapIds) {
      const lockAcquired = await memory.acquireGapLock(gapId, AgentType.CODER);
      if (lockAcquired) {
        try {
          const res = await memory.updateGapStatus(gapId, GapStatus.PROGRESS);
          if (!res.success) {
            logger.warn(`[Coder] Failed to transition gap ${gapId} to PROGRESS: ${res.error}`);
          }
        } finally {
          await memory.releaseGapLock(gapId, AgentType.CODER);
        }
      }
    }
  }

  // 4. Process the task via unified lifecycle (Session Locking + Heartbeat)
  const { processEventWithAgent } = await import('../handlers/events/shared');

  interface CoderParsedData {
    patch?: string;
    buildId?: string;
  }

  let result: {
    responseText: string;
    attachments: Message['attachments'];
    parsedData?: CoderParsedData;
  };
  try {
    const processResult = await processEventWithAgent(userId, AgentType.CODER, task || '', {
      context,
      traceId,
      taskId: taskId ?? traceId,
      sessionId,
      depth,
      initiatorId,
      isContinuation,
      attachments: metadata?.attachments as Attachment[],
      handlerTitle: 'Coder Agent',
      outboundHandlerName: AgentType.CODER,
      formatResponse: (text) => text,
    });
    result = {
      ...processResult,
      parsedData: processResult.parsedData as CoderParsedData | undefined,
    };
  } catch (err) {
    logger.error('Unexpected error in Coder Agent processing:', err);
    result = {
      responseText: `SYSTEM_ERROR: ${err instanceof Error ? err.message : String(err)}`,
      attachments: [],
    };
  } finally {
    process.chdir(originalCwd);
    await cleanupWorkspace(workspacePath);
  }

  let responseText = result.responseText;
  const isFailure = detectFailure(responseText);
  const parsed = result.parsedData;

  // 5. Evolution Validation: Require patch for successful evolution tasks
  if (gapIds && gapIds.length > 0 && !isFailure && !isTaskPaused(responseText)) {
    if (!parsed?.patch) {
      logger.error('[Coder] Evolution task successful but no patch was returned.');
      responseText = `FAILED: Evolution task requires a technical patch for gaps: ${gapIds.join(', ')}`;
    }
  }

  // 6. Gap Management - Final State (Phase B2: Atomic Transitions)
  if (gapIds && gapIds.length > 0) {
    const finalStatus =
      detectFailure(responseText) || isTaskPaused(responseText)
        ? GapStatus.OPEN
        : parsed?.buildId
          ? GapStatus.PROGRESS // Still in progress if building
          : GapStatus.DEPLOYED;

    for (const gapId of gapIds) {
      const lockAcquired = await memory.acquireGapLock(gapId, AgentType.CODER);
      if (lockAcquired) {
        try {
          const res = await memory.updateGapStatus(gapId, finalStatus);
          if (!res.success) {
            const step = finalStatus === GapStatus.OPEN ? 'reset' : 'transition';
            logger.warn(`[Gaps] Failed to ${step} gap ${gapId} to ${finalStatus}: ${res.error}`);
          }
        } finally {
          await memory.releaseGapLock(gapId, AgentType.CODER);
        }
      }
    }
  }

  // 7. Final response and outbound message (Only if not already sent by shared handler)
  // Note: processEventWithAgent already calls sendOutboundMessage if response is not paused.
  // We only need to call it if we modified the responseText here (e.g. added FAILED prefix).
  if (responseText !== result.responseText && !isTaskPaused(responseText)) {
    const baseUserId = extractBaseUserId(userId);
    await sendOutboundMessage(
      AgentType.CODER,
      userId,
      responseText,
      [baseUserId],
      sessionId,
      config.name,
      result.attachments
    );
  }

  // 8. Trace gap transitions if successful
  if (!detectFailure(responseText) && !isTaskPaused(responseText)) {
    const { addTraceStep } = await import('../lib/utils/trace-helper');
    await addTraceStep(traceId || 'unknown', 'root', {
      type: TRACE_TYPES.CODE_WRITTEN,
      content: {
        status: 'SUCCESS',
        responseSnippet: responseText.substring(0, 500),
      },
      metadata: { event: 'code_written' },
    });
  }

  // 9. Emit Task Result
  const { emitTaskEvent } = await import('../lib/utils/agent-helpers/event-emitter');
  await emitTaskEvent({
    source: `${AgentType.CODER}.agent`,
    agentId: AgentType.CODER,
    userId: extractBaseUserId(userId),
    task: task || '',
    response: responseText,
    traceId,
    taskId: payload.taskId,
    sessionId,
    initiatorId,
    depth,
    metadata: {
      patch: parsed?.patch,
      buildId: parsed?.buildId,
    },
  });

  return responseText;
};
