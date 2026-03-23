import { getRecursionLimit, handleRecursionLimitExceeded, wakeupInitiator } from './shared';
import { DynamicScheduler } from '../../lib/scheduler';
import { ConfigManager } from '../../lib/registry/config';
import { EventType, AgentType } from '../../lib/types/agent';

/**
 * Handles clarification request events - relays clarification question to initiator.
 *
 * @param eventDetail - The clarification request event detail.
 * @returns A promise resolving when the clarification request is processed.
 */
export async function handleClarificationRequest(
  eventDetail: Record<string, unknown>
): Promise<void> {
  const {
    userId,
    agentId,
    question,
    traceId,
    initiatorId,
    depth,
    sessionId,
    originalTask,
    retryCount,
  } = eventDetail as unknown as {
    userId: string;
    agentId: string;
    question: string;
    traceId?: string;
    initiatorId?: string;
    depth?: number;
    sessionId?: string;
    originalTask: string;
    retryCount?: number;
  };

  const currentDepth = depth ?? 1;
  const currentRetryCount = retryCount ?? 0;

  const { logger, DynamoMemory } = await import('../../lib/logger').then(async (m) => {
    const mem = await import('../../lib/memory');
    return { logger: m.logger, DynamoMemory: mem.DynamoMemory };
  });

  logger.info(
    `Relaying clarification request from ${agentId} to Initiator: ${initiatorId ?? 'Orchestrator'} (Depth: ${currentDepth}, Session: ${sessionId}, Retry: ${currentRetryCount})`
  );

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

  try {
    const memory = new DynamoMemory();
    const safeTraceId = traceId ?? `unknown-${Date.now()}`;
    const safeAgentId = agentId ?? 'unknown';

    await memory.saveClarificationRequest({
      userId: `CLARIFICATION#${safeTraceId}#${safeAgentId}`,
      agentId: safeAgentId,
      initiatorId: initiatorId ?? AgentType.SUPERCLAW,
      question,
      originalTask,
      traceId: safeTraceId,
      sessionId,
      depth: currentDepth,
      status: 'pending',
      createdAt: Date.now(),
      retryCount: currentRetryCount,
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
        initiatorId: initiatorId ?? AgentType.SUPERCLAW,
        originalTask,
        question,
        sessionId,
        depth: currentDepth,
        retryCount: currentRetryCount,
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
    initiatorId ?? AgentType.SUPERCLAW,
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
