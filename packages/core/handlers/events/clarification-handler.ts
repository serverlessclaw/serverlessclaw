import { wakeupInitiator } from './shared';
import { DynamicScheduler } from '../../lib/lifecycle/scheduler';
import { ConfigManager } from '../../lib/registry/config';
import { EventType } from '../../lib/types/agent';
import { ClarificationStatus } from '../../lib/types/memory';
import { addTraceStep } from '../../lib/utils/trace-helper';
import { TRACE_TYPES } from '../../lib/constants';
import { z } from 'zod';
import { UserRole } from '../../lib/types/index';

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
    workspaceId,
    teamId,
    staffId,
    userRole,
  } = parsed;

  const { extractClarificationMetadata } = await import('../../lib/utils/metadata');
  const typedMetadata = extractClarificationMetadata(metadata);

  // Flexibility: Look for question and originalTask in direct detail (legacy/tests) OR metadata
  const question = (eventDetail.question as string) ?? typedMetadata.question ?? task;
  const originalTask = (eventDetail.originalTask as string) ?? typedMetadata.originalTask ?? task;
  const retryCount = (eventDetail.retryCount as number) ?? typedMetadata.retryCount;

  const { logger, DynamoMemory } = await import('../../lib/logger').then(async (m) => {
    const mem = await import('../../lib/memory');
    return { logger: m.logger, DynamoMemory: mem.DynamoMemory };
  });

  logger.info(
    `Relaying clarification request from ${agentId} to Initiator: ${initiatorId} (Depth: ${depth}, Session: ${sessionId}, Retry: ${retryCount})`
  );

  const safeTraceId = traceId ?? `unknown-${Date.now()}`;
  const safeAgentId = agentId;

  // Trace: Agent is requesting clarification (waiting state)
  await addTraceStep(safeTraceId, safeAgentId, {
    type: TRACE_TYPES.CLARIFICATION_REQUEST,
    content: {
      agentId: safeAgentId,
      initiatorId,
      question,
      originalTask,
      retryCount,
      depth,
    },
    metadata: { event: 'clarification_request', agentId: safeAgentId },
  });

  // Trace: Mark the requesting agent as waiting
  await addTraceStep(safeTraceId, safeAgentId, {
    type: TRACE_TYPES.AGENT_WAITING,
    content: {
      agentId: safeAgentId,
      reason: 'Waiting for clarification from initiator',
      question,
    },
    metadata: { event: 'agent_waiting', agentId: safeAgentId },
  });

  try {
    const memory = new DynamoMemory();

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

    const rawTimeout = await ConfigManager.getRawConfig('clarification_timeout_ms');
    const timeoutMs = z.coerce.number().safeParse(rawTimeout).data ?? 300000;
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
        workspaceId,
        teamId,
        staffId,
        userRole,
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

  // Trace: Wakeup initiator with clarification question
  await addTraceStep(safeTraceId, 'root', {
    type: TRACE_TYPES.CONTINUATION,
    content: {
      direction: 'to_initiator',
      initiatorId,
      requestingAgent: safeAgentId,
      question,
    },
    metadata: { event: 'clarification_relay', initiatorId },
  });

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
    depth,
    false,
    [
      { label: 'Provide Clarification', value: 'I will provide clarification: ', type: 'primary' },
      { label: 'Cancel Task', value: `CANCEL_TASK:${safeTraceId}`, type: 'danger' },
    ],
    undefined,
    undefined,
    workspaceId,
    teamId,
    staffId,
    userRole as UserRole
  );
}
