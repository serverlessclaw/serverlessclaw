import { EventType } from '../../lib/types/index';
import { CompletionEventSchema, FailureEventSchema } from '../../lib/schema/events';
import { getRecursionLimit, handleRecursionLimitExceeded, wakeupInitiator } from './shared';

/**
 * Handles task completion and failure events - relays results to initiator.
 *
 * @param eventDetail - The detail of the EventBridge event.
 * @param detailType - The type of the EventBridge event.
 */
export async function handleTaskResult(
  eventDetail: Record<string, unknown>,
  detailType: string
): Promise<void> {
  const isFailure = detailType === EventType.TASK_FAILED;
  const parsedEvent = isFailure
    ? FailureEventSchema.parse(eventDetail)
    : CompletionEventSchema.parse(eventDetail);

  const { userId, agentId, task, traceId, initiatorId, depth, sessionId } = parsedEvent;
  const response = 'error' in parsedEvent ? parsedEvent.error : parsedEvent.response;

  const currentDepth = depth ?? 1;

  // Use shared logger
  const { logger } = await import('../../lib/logger');

  logger.info(
    `Relaying ${isFailure ? 'failure' : 'completion'} from ${agentId} to Initiator: ${initiatorId ?? 'Orchestrator'} (Depth: ${currentDepth}, Session: ${sessionId})`
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
  if (!initiatorId) {
    logger.info(
      `No initiator found for ${agentId} task. Treating as background background completion.`
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
    currentDepth
  );
}
