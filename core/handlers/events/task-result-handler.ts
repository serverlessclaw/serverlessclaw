import { EventType } from '../../lib/types/index';
import { COMPLETION_EVENT_SCHEMA, FAILURE_EVENT_SCHEMA } from '../../lib/schema/events';
import { getRecursionLimit, handleRecursionLimitExceeded, wakeupInitiator } from './shared';

/**
 * Handles task completion and failure events - relays results to initiator.
 *
 * @param eventDetail - The detail of the EventBridge event.
 * @param detailType - The type of the EventBridge event.
 * @since 2026-03-19
 */
export async function handleTaskResult(
  eventDetail: Record<string, unknown>,
  detailType: string
): Promise<void> {
  const isFailure = detailType === EventType.TASK_FAILED;
  const parsedEvent = isFailure
    ? FAILURE_EVENT_SCHEMA.parse(eventDetail)
    : COMPLETION_EVENT_SCHEMA.parse(eventDetail);

  const { userId, agentId, task, traceId, initiatorId, depth, sessionId, userNotified } =
    parsedEvent;
  const response = 'error' in parsedEvent ? parsedEvent.error : parsedEvent.response;

  const currentDepth = depth ?? 1;

  // Use shared logger
  const { logger } = await import('../../lib/logger');

  logger.info(
    `Relaying ${isFailure ? 'failure' : 'completion'} from ${agentId} to Initiator: ${initiatorId ?? 'Orchestrator'} (Depth: ${currentDepth}, Session: ${sessionId}, UserNotified: ${userNotified})`
  );

  // 1. Loop Protection - Use shared function
  const RECURSION_LIMIT = await getRecursionLimit();

  if (currentDepth >= RECURSION_LIMIT) {
    logger.error(`Recursion Limit Exceeded (Depth: ${currentDepth}) for user ${userId}. Aborting.`);
    await handleRecursionLimitExceeded(
      userId,
      sessionId,
      'task-result-handler',
      `I have detected an infinite loop between agents (Depth: ${currentDepth}). I've intervened to stop the process. Please check the orchestration logic. You can increase this limit in the System Config.`
    );
    return;
  }

  // 2. Dynamic Routing
  // If no initiator is provided, this was likely a background system task (e.g. reflection).
  // We do not wake up anyone in this case to prevent unexpected user-facing messages.
  // Also, prevent the main agent from waking itself up to avoid infinite acknowledgment loops.
  if (!initiatorId || (agentId === 'main' && initiatorId === 'main')) {
    logger.info(
      `No continuation needed for ${agentId} task (Initiator: ${initiatorId ?? 'N/A'}). Treating as background completion.`
    );
    return;
  }

  const resultPrefix = isFailure ? 'DELEGATED_TASK_FAILURE' : 'DELEGATED_TASK_RESULT';

  await wakeupInitiator(
    userId,
    initiatorId,
    `${resultPrefix}: Agent '${agentId}' has ${isFailure ? 'failed' : 'completed'} the task: "${task}". 
      ${isFailure ? 'Error' : 'Result'}:
      ---
      ${response}
      ---
      Please continue your logic based on this result.`,
    traceId,
    sessionId,
    currentDepth,
    userNotified
  );

  // 3. Parallel Dispatch Aggregation
  // Check if this result is part of a parallel dispatch
  if (traceId) {
    const { aggregator } = await import('../../lib/agent/parallel-aggregator');
    const { ConfigManager } = await import('../../lib/registry/config');
    const aggregateState = await aggregator.addResult(userId, traceId, {
      taskId: (eventDetail.taskId as string) ?? agentId,
      agentId,
      status: isFailure ? 'failed' : 'success',
      result: response,
      durationMs: 0,
    });

    if (aggregateState?.isComplete) {
      logger.info(`Parallel dispatch ${traceId} complete! Emitting aggregated results.`);
      const { emitEvent } = await import('../../lib/utils/bus');

      const threshold =
        ((await ConfigManager.getRawConfig('parallel_partial_success_threshold')) as number) ?? 0.5;
      const successCount = aggregateState.results.filter((r) => r.status === 'success').length;
      const successRate = successCount / aggregateState.taskCount;

      const overallStatus =
        successRate === 1 ? 'success' : successRate >= threshold ? 'partial' : 'failed';

      // Atomic completion check to prevent double-firing with timeout handler
      const marked = await aggregator.markAsCompleted(userId, traceId, overallStatus);

      if (marked) {
        await emitEvent('events.handler', EventType.PARALLEL_TASK_COMPLETED, {
          userId,
          sessionId: aggregateState.sessionId,
          traceId,
          initiatorId: aggregateState.initiatorId,
          overallStatus,
          results: aggregateState.results,
          taskCount: aggregateState.taskCount,
          completedCount: aggregateState.results.length,
          elapsedMs: 0,
        });
      } else {
        logger.info(`Parallel dispatch ${traceId} already marked as completed, skipping event.`);
      }
    }
  }
}
