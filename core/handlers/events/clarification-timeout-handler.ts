import { EventType, AgentType } from '../../lib/types/agent';
import { logger } from '../../lib/logger';
import { emitEvent, EventPriority } from '../../lib/utils/bus';
import { DynamoMemory } from '../../lib/memory';
import { ConfigManager } from '../../lib/registry/config';
import { sendOutboundMessage } from '../../lib/outbound';

export async function handleClarificationTimeout(
  eventDetail: Record<string, unknown>
): Promise<void> {
  const {
    userId,
    agentId,
    traceId,
    initiatorId,
    originalTask,
    question,
    sessionId,
    depth,
    retryCount = 0,
  } = eventDetail as unknown as {
    userId: string;
    agentId: string;
    traceId: string;
    initiatorId: string;
    originalTask: string;
    question: string;
    sessionId?: string;
    depth?: number;
    retryCount?: number;
  };

  logger.info(
    `Handling clarification timeout: traceId=${traceId}, agentId=${agentId}, retryCount=${retryCount}`
  );

  const memory = new DynamoMemory();
  const currentState = await memory.getClarificationRequest(traceId, agentId);

  if (!currentState) {
    logger.warn(
      `No clarification state found for ${traceId}/${agentId}, assuming already handled.`
    );
    return;
  }

  if (currentState.status === 'answered') {
    logger.info(`Clarification already answered for ${traceId}/${agentId}, ignoring timeout.`);
    return;
  }

  if (currentState.status === 'timed_out' || currentState.status === 'escalated') {
    logger.info(
      `Clarification already timed out/escalated for ${traceId}/${agentId}, ignoring timeout.`
    );
    return;
  }

  const maxRetries =
    ((await ConfigManager.getRawConfig('clarification_max_retries')) as number) ?? 1;
  const newRetryCount = retryCount + 1;

  if (newRetryCount <= maxRetries) {
    logger.info(
      `Retrying clarification request for ${traceId}/${agentId}: attempt ${newRetryCount}/${maxRetries}`
    );

    await memory.updateClarificationStatus(traceId, agentId, 'pending');

    await emitEvent(
      'events.handler',
      EventType.CLARIFICATION_REQUEST,
      {
        userId,
        agentId,
        question: `[RETRY ${newRetryCount}/${maxRetries}] ${question}`,
        traceId,
        initiatorId: initiatorId ?? AgentType.SUPERCLAW,
        depth: (depth ?? 0) + 1,
        sessionId,
        originalTask,
        retryCount: newRetryCount,
      },
      { priority: EventPriority.HIGH }
    );

    logger.info(`Re-emitted clarification request with retry ${newRetryCount}`);
    return;
  }

  logger.warn(
    `Clarification timeout exhausted for ${traceId}/${agentId}. Escalating to SuperClaw.`
  );

  await memory.updateClarificationStatus(traceId, agentId, 'timed_out');

  await emitEvent(
    'events.handler',
    EventType.TASK_FAILED,
    {
      userId,
      agentId,
      task: originalTask,
      error: `Clarification request timed out after ${maxRetries} retry attempts. Question: ${question}`,
      traceId,
      initiatorId,
      sessionId,
      depth: (depth ?? 0) + 1,
    },
    { priority: EventPriority.CRITICAL }
  );

  await sendOutboundMessage(
    'clarification-timeout-handler',
    userId,
    `⚠️ **Clarification Timeout**\n\nAgent '${agentId}' requested clarification but received no response after ${maxRetries} attempts.\n\n**Question:**\n${question}\n\n**Task:** ${originalTask}\n\nThe task has been marked as failed. Please review and retry manually if needed.`,
    undefined,
    sessionId,
    'SuperClaw',
    undefined
  );

  logger.info(`Escalated clarification timeout to SuperClaw for user ${userId}`);
}
