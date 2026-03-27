/**
 * Clarification Operations Module
 *
 * Contains clarification state management methods for the DynamoMemory class.
 * These functions provide state persistence for the clarification protocol,
 * enabling crash recovery and timeout detection for orphan clarifications.
 */

import { logger } from '../logger';
import { TIME } from '../constants';
import type { BaseMemoryProvider } from './base';
import { ClarificationStatus, ClarificationState } from '../types/memory';
import { EscalationState } from '../types/escalation';

const CLARIFICATION_PREFIX = 'CLARIFICATION#';
const ESCALATION_PREFIX = 'ESCALATION#';
const TTL_BUFFER_SECONDS = 3600; // 1 hour
const ESCALATION_TTL_BUFFER_SECONDS = 86400; // 24 hours for escalation state

/**
 * Saves a clarification request to DynamoDB for state persistence.
 *
 * @param base - The base memory provider instance.
 * @param state - The clarification state to save.
 * @returns A promise that resolves when the state is saved.
 */
export async function saveClarificationRequest(
  base: BaseMemoryProvider,
  state: Omit<ClarificationState, 'type' | 'expiresAt' | 'timestamp'>
): Promise<void> {
  const ttlBufferSeconds = TTL_BUFFER_SECONDS;
  const item: ClarificationState = {
    ...state,
    timestamp: 0, // Force timestamp 0 for easier updates by PK (userId)
    type: 'CLARIFICATION_PENDING',
    expiresAt: Math.floor(Date.now() / TIME.MS_PER_SECOND) + ttlBufferSeconds,
  };

  await base.putItem(item as unknown as Record<string, unknown>);
  logger.info(`Saved clarification request: traceId=${state.traceId}, agentId=${state.agentId}`);
}

/**
 * Retrieves a clarification request by traceId and agentId.
 *
 * @param base - The base memory provider instance.
 * @param traceId - The trace ID of the clarification.
 * @param agentId - The agent ID that requested clarification.
 * @returns A promise resolving to the clarification state or null if not found.
 */
export async function getClarificationRequest(
  base: BaseMemoryProvider,
  traceId: string,
  agentId: string
): Promise<ClarificationState | null> {
  const pk = `${CLARIFICATION_PREFIX}${traceId}#${agentId}`;

  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :pk',
    ExpressionAttributeValues: {
      ':pk': pk,
    },
    Limit: 1,
  });

  if (items.length === 0) {
    return null;
  }

  return items[0] as unknown as ClarificationState;
}

/**
 * Saves escalation state for a clarification.
 *
 * @param base - The base memory provider instance.
 * @param state - The escalation state to save.
 * @returns A promise that resolves when the state is saved.
 */
export async function saveEscalationState(
  base: BaseMemoryProvider,
  state: EscalationState
): Promise<void> {
  const pk = `${ESCALATION_PREFIX}${state.traceId}#${state.agentId}`;
  const item = {
    ...state,
    userId: pk,
    timestamp: 0,
    type: 'ESCALATION_STATE',
    expiresAt: Math.floor(Date.now() / TIME.MS_PER_SECOND) + ESCALATION_TTL_BUFFER_SECONDS,
  };

  await base.putItem(item as unknown as Record<string, unknown>);
  logger.info(`Saved escalation state: traceId=${state.traceId}, agentId=${state.agentId}`);
}

/**
 * Retrieves escalation state for a clarification.
 *
 * @param base - The base memory provider instance.
 * @param traceId - The trace ID.
 * @param agentId - The agent ID.
 * @returns A promise resolving to the escalation state or null if not found.
 */
export async function getEscalationState(
  base: BaseMemoryProvider,
  traceId: string,
  agentId: string
): Promise<EscalationState | null> {
  const pk = `${ESCALATION_PREFIX}${traceId}#${agentId}`;

  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :pk',
    ExpressionAttributeValues: {
      ':pk': pk,
    },
    Limit: 1,
  });

  if (items.length === 0) {
    return null;
  }

  return items[0] as unknown as EscalationState;
}

/**
 * Updates the status of a clarification request.
 *
 * @param base - The base memory provider instance.
 * @param traceId - The trace ID of the clarification.
 * @param agentId - The agent ID that requested clarification.
 * @param status - The new status to set.
 * @returns A promise that resolves when the status is updated.
 */
export async function updateClarificationStatus(
  base: BaseMemoryProvider,
  traceId: string,
  agentId: string,
  status: ClarificationStatus
): Promise<void> {
  const pk = `${CLARIFICATION_PREFIX}${traceId}#${agentId}`;

  await base.updateItem({
    Key: { userId: pk, timestamp: 0 },
    UpdateExpression: 'SET #status = :status',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': status,
    },
  });

  logger.info(
    `Updated clarification status: traceId=${traceId}, agentId=${agentId}, status=${status}`
  );
}

/**
 * Finds all expired clarification requests (for orphan detection).
 * This is used by scheduled jobs to detect clarifications that were never answered.
 *
 * @param base - The base memory provider instance.
 * @returns A promise resolving to an array of expired clarification states.
 */
export async function findExpiredClarifications(
  base: BaseMemoryProvider
): Promise<ClarificationState[]> {
  const now = Math.floor(Date.now() / TIME.MS_PER_SECOND);

  const items = await base.queryItems({
    IndexName: 'TypeTimestampIndex',
    KeyConditionExpression: '#type = :type',
    FilterExpression: '#status = :status AND #expiresAt < :now',
    ExpressionAttributeNames: {
      '#type': 'type',
      '#status': 'status',
      '#expiresAt': 'expiresAt',
    },
    ExpressionAttributeValues: {
      ':type': 'CLARIFICATION_PENDING',
      ':status': 'pending',
      ':now': now,
    },
  });

  return items as unknown as ClarificationState[];
}

/**
 * Increments the retry count for a clarification request.
 *
 * @param base - The base memory provider instance.
 * @param traceId - The trace ID of the clarification.
 * @param agentId - The agent ID that requested clarification.
 * @returns A promise resolving to the new retry count.
 */
export async function incrementClarificationRetry(
  base: BaseMemoryProvider,
  traceId: string,
  agentId: string
): Promise<number> {
  const pk = `${CLARIFICATION_PREFIX}${traceId}#${agentId}`;

  const result = await base.updateItem({
    Key: { userId: pk, timestamp: 0 },
    UpdateExpression: 'SET retryCount = retryCount + :one',
    ExpressionAttributeValues: {
      ':one': 1,
    },
    ReturnValues: 'ALL_NEW',
  });

  return (result as unknown as ClarificationState)?.retryCount ?? 0;
}
