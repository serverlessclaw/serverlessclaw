import { EventType, AGENT_TYPES } from '../../lib/types/agent';
import { ClarificationStatus } from '../../lib/types/memory';
import { logger } from '../../lib/logger';
import { emitEvent, EventPriority } from '../../lib/utils/bus';
import { DynamoMemory } from '../../lib/memory';
import { ConfigManager } from '../../lib/registry/config';
import { escalationManager } from '../../lib/lifecycle/escalation-manager';

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

  if (currentState.status === ClarificationStatus.ANSWERED) {
    logger.info(`Clarification already answered for ${traceId}/${agentId}, ignoring timeout.`);
    return;
  }

  if (
    currentState.status === ClarificationStatus.TIMED_OUT ||
    currentState.status === ClarificationStatus.ESCALATED
  ) {
    logger.info(
      `Clarification already timed out/escalated for ${traceId}/${agentId}, ignoring timeout.`
    );
    return;
  }

  // Check if escalation is enabled
  const escalationEnabled = await ConfigManager.getRawConfig('escalation_enabled');

  if (escalationEnabled === true) {
    // Use escalation manager for multi-level escalation
    try {
      // Check if there's already an escalation in progress to avoid double-starting
      const existingEscalation = await escalationManager.getEscalationState(traceId, agentId);

      if (existingEscalation) {
        logger.info(`Escalation already in progress for ${traceId}/${agentId}, ignoring timeout.`);
        return;
      }

      // Start new escalation
      await escalationManager.startEscalation(
        traceId,
        agentId,
        userId,
        question,
        originalTask,
        sessionId
      );
      logger.info(`Started escalation for ${traceId}/${agentId}`);
      return;
    } catch (error) {
      logger.error(`Escalation failed, falling back to legacy behavior:`, error);
      // Fall through to legacy behavior
    }
  }

  // Legacy behavior: simple retry mechanism
  const maxRetries =
    ((await ConfigManager.getRawConfig('clarification_max_retries')) as number) ?? 1;
  const newRetryCount = retryCount + 1;

  if (newRetryCount <= maxRetries) {
    logger.info(
      `Retrying clarification request for ${traceId}/${agentId}: attempt ${newRetryCount}/${maxRetries}`
    );

    await memory.updateClarificationStatus(traceId, agentId, ClarificationStatus.PENDING);

    await emitEvent(
      'events.handler',
      EventType.CLARIFICATION_REQUEST,
      {
        userId,
        agentId,
        question: `[RETRY ${newRetryCount}/${maxRetries}] ${question}`,
        traceId,
        initiatorId: initiatorId ?? AGENT_TYPES.SUPERCLAW,
        depth: depth ?? 0,
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
    `Clarification timeout exhausted for ${traceId}/${agentId}. Performing Strategic Tie-break.`
  );

  await memory.updateClarificationStatus(traceId, agentId, ClarificationStatus.TIMED_OUT);

  // Perform Strategic Tie-break: Continue task with best-effort assumptions
  const tieBreakTask = `STRATEGIC_TIE_BREAK: The human input timed out. Proceeding with the original task: "${originalTask}" by making safe, best-effort assumptions based on the system context. Avoid high-risk operations until explicitly approved.`;

  await emitEvent(
    'events.handler',
    EventType.STRATEGIC_TIE_BREAK,
    {
      userId,
      agentId,
      task: tieBreakTask,
      originalTask,
      question,
      traceId,
      initiatorId: initiatorId ?? AGENT_TYPES.SUPERCLAW,
      sessionId,
      depth: depth ?? 0,
    },
    { priority: EventPriority.HIGH }
  );

  // Notify the user via the report-back mechanism
  await emitEvent('events.handler', EventType.REPORT_BACK, {
    userId,
    action: `Strategic Tie-break for agent '${agentId}'`,
    reason: `Clarification request timed out after ${maxRetries} attempts.`,
    result: `The system is continuing with best-effort assumptions to maintain momentum.`,
    traceId,
    sessionId,
    agentId: AGENT_TYPES.SUPERCLAW,
  });

  logger.info(`Initiated Strategic Tie-break for user ${userId} due to clarification timeout.`);
}
