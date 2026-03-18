import { getRecursionLimit, handleRecursionLimitExceeded, wakeupInitiator } from './shared';

/**
 * Handles clarification request events - relays clarification question to initiator.
 *
 * @param eventDetail - The clarification request event detail.
 * @returns A promise resolving when the clarification request is processed.
 */
export async function handleClarificationRequest(
  eventDetail: Record<string, unknown>
): Promise<void> {
  const { userId, agentId, question, traceId, initiatorId, depth, sessionId, originalTask } =
    eventDetail as unknown as {
      userId: string;
      agentId: string;
      question: string;
      traceId?: string;
      initiatorId?: string;
      depth?: number;
      sessionId?: string;
      originalTask: string;
    };

  const currentDepth = depth ?? 1;

  // Use shared logger
  const { logger } = await import('../../lib/logger');

  logger.info(
    `Relaying clarification request from ${agentId} to Initiator: ${initiatorId ?? 'Orchestrator'} (Depth: ${currentDepth}, Session: ${sessionId})`
  );

  // 1. Loop Protection - Use shared function
  const RECURSION_LIMIT = await getRecursionLimit();

  if (currentDepth >= RECURSION_LIMIT) {
    logger.error(
      `Recursion Limit Exceeded for CLARIFICATION_REQUEST (Depth: ${currentDepth}) for user ${userId}. Aborting.`
    );
    await handleRecursionLimitExceeded(
      userId,
      sessionId,
      'clarification-handler',
      `I have detected an infinite loop in clarification requests (Depth: ${currentDepth}). I've intervened to stop the process.`
    );
    return;
  }

  await wakeupInitiator(
    userId,
    initiatorId ?? 'main',
    `CLARIFICATION_REQUEST: Agent '${agentId}' needs clarification while working on: "${originalTask}".
      Question:
      ---
      ${question}
      ---
      Please provide the necessary directions to the agent using the "provideClarification" tool.`,
    traceId,
    sessionId,
    currentDepth
  );
}
