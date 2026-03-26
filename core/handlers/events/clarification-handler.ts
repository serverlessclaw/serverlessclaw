import { getRecursionLimit, handleRecursionLimitExceeded, wakeupInitiator } from './shared';
import { DynamicScheduler } from '../../lib/scheduler';
import { ConfigManager } from '../../lib/registry/config';
import { EventType } from '../../lib/types/agent';
import { ClarificationStatus } from '../../lib/types/memory';

import { AGENT_PAYLOAD_SCHEMA } from '../../lib/schema/events';

/**
 * Handles clarification request events - relays clarification question to initiator.
 *
 * @param eventDetail - The clarification request event detail.
 * @returns A promise resolving when the clarification request is processed.
 */
export async function handleClarificationRequest(
  eventDetail: Record<string, unknown>
): Promise<void> {
  const parsed = AGENT_PAYLOAD_SCHEMA.parse(eventDetail);
  const {
    userId,
    agentId = 'unknown',
    task,
    traceId,
    initiatorId,
    depth,
    sessionId,
    metadata,
  } = parsed;

  // Flexibility: Look for question and originalTask in direct detail (legacy/tests) OR metadata
  const question = (eventDetail.question as string) ?? (metadata?.question as string) ?? task;
  const originalTask =
    (eventDetail.originalTask as string) ?? (metadata?.originalTask as string) ?? task;
  const retryCount = (eventDetail.retryCount as number) ?? (metadata?.retryCount as number) ?? 0;

  const { logger, DynamoMemory } = await import('../../lib/logger').then(async (m) => {
    const mem = await import('../../lib/memory');
    return { logger: m.logger, DynamoMemory: mem.DynamoMemory };
  });

  logger.info(
    `Relaying clarification request from ${agentId} to Initiator: ${initiatorId} (Depth: ${depth}, Session: ${sessionId}, Retry: ${retryCount})`
  );

  const RECURSION_LIMIT = await getRecursionLimit();

  if (depth >= RECURSION_LIMIT) {
    logger.error(
      `Recursion Limit Exceeded for CLARIFICATION_REQUEST (Depth: ${depth}) for user ${userId}. Aborting.`
    );
    await handleRecursionLimitExceeded(
      userId,
      sessionId,
      'clarification-handler',
      `I have detected an infinite loop in clarification requests (Depth: ${depth}). I've intervened to stop the process.`
    );
    return;
  }

  try {
    const memory = new DynamoMemory();
    const safeTraceId = traceId ?? `unknown-${Date.now()}`;
    const safeAgentId = agentId;

    await memory.saveClarificationRequest({
      userId: `CLARIFICATION#${safeTraceId}#${safeAgentId}`,
      agentId: safeAgentId,
      initiatorId: initiatorId,
      question,
      originalTask,
      traceId: safeTraceId,
      sessionId,
      depth,
      status: ClarificationStatus.PENDING,
      createdAt: Date.now(),
      retryCount,
    });

    const timeoutMs =
      ((await ConfigManager.getRawConfig('clarification_timeout_ms')) as number) ?? 300000;
    const targetTime = Date.now() + timeoutMs;
    const timeoutId = `clarify-${safeTraceId}-${safeAgentId}-${Date.now()}`;

    await DynamicScheduler.scheduleOneShotTimeout(
      timeoutId,
      {
        userId,
        agentId: safeAgentId,
        traceId: safeTraceId,
        initiatorId,
        originalTask,
        question,
        sessionId,
        depth,
        retryCount,
      },
      targetTime,
      EventType.CLARIFICATION_TIMEOUT
    );
    logger.info(
      `Scheduled clarification timeout for ${timeoutId}: ${new Date(targetTime).toISOString()}`
    );
  } catch (error) {
    logger.warn(`Failed to process clarification request:`, error);
  }

  await wakeupInitiator(
    userId,
    initiatorId,
    `CLARIFICATION_REQUEST: Agent '${agentId}' needs clarification while working on: "${originalTask}".
      Question:
      ---
      ${question}
      ---
      Please provide the necessary directions to the agent using the "provideClarification" tool.`,
    traceId,
    sessionId,
    depth
  );
}
