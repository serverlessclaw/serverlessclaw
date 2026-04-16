/**
 * Session Operations Module
 *
 * Contains conversation, message, and session management methods for the DynamoMemory class.
 * These functions operate on a BaseMemoryProvider instance.
 */

import { Message } from '../types/llm';
import { ConversationMeta } from '../types/memory';
import { RetentionManager } from './tiering';
import type { BaseMemoryProvider } from './base';
import { filterPIIFromObject } from '../utils/pii';
import { queryLatestContentByUserId } from './utils';
import { RETENTION } from '../constants/memory';
import { logger } from '../logger';
import { sessionIdToSortKey, fnv1aHash } from '../utils/id-generator';

/**
 * Appends a new message with tiered retention.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @param message - The message object to add.
 * @param workspaceId - Optional workspace identifier for isolation.
 * @returns A promise resolving when the message is added.
 */
export async function addMessage(
  base: BaseMemoryProvider,
  userId: string,
  message: Message,
  workspaceId?: string
): Promise<void> {
  const scopedUserId = base.getScopedUserId(userId, workspaceId);
  const { expiresAt, type } = await RetentionManager.getExpiresAt('MESSAGES', scopedUserId);
  const scrubbedMessage = filterPIIFromObject(message);
  await base.putItem({
    userId: scopedUserId,
    timestamp: Date.now(),
    createdAt: Date.now(),
    type,
    expiresAt,
    workspaceId,
    ...scrubbedMessage,
  });
}

/**
 * Deletes a conversation session and its history.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @param sessionId - The session identifier to delete.
 * @param workspaceId - Optional workspace identifier for isolation.
 * @returns A promise resolving when the conversation is deleted.
 */
export async function deleteConversation(
  base: BaseMemoryProvider,
  userId: string,
  sessionId: string,
  workspaceId?: string
): Promise<void> {
  const normalizedUserId = userId.replace(/^(SESSIONS#)+/, '');
  // We must list conversations to find the exact Sort Key (timestamp) for the session,
  // as saveConversationMeta may append collision suffixes that cannot be derived.
  const conversations = await base.listConversations(normalizedUserId, workspaceId);
  const existing = conversations.find((c) => c.sessionId === sessionId);

  if (existing) {
    const scopedSessionsId = base.getScopedUserId(`SESSIONS#${normalizedUserId}`, workspaceId);
    await base.deleteItem({
      userId: scopedSessionsId,
      timestamp: existing.updatedAt, // existing.updatedAt maps to the 'timestamp' SK attribute
    });
  }

  // Clear message history (Keyed by CONV#userId#sessionId)
  await base.clearHistory(`CONV#${normalizedUserId}#${sessionId}`, workspaceId);
}

/**
 * Updates distilled memory with a 2-year retention policy.
 * Uses a fixed timestamp (0) to ensure we only keep the latest version per user.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @param facts - The distilled facts string to store.
 * @param workspaceId - Optional workspace identifier for isolation.
 * @returns A promise resolving when memory is updated.
 */
export async function updateDistilledMemory(
  base: BaseMemoryProvider,
  userId: string,
  facts: string,
  workspaceId?: string
): Promise<void> {
  const normalizedUserId = userId.replace(/^(DISTILLED#)+/, '');
  const scopedUserId = base.getScopedUserId(`DISTILLED#${normalizedUserId}`, workspaceId);
  const { expiresAt } = await RetentionManager.getExpiresAt('DISTILLED', normalizedUserId);
  await base.putItem({
    userId: scopedUserId,
    timestamp: 0,
    type: 'DISTILLED',
    expiresAt,
    content: facts,
    workspaceId,
  });
}

/**
 * Saves or updates session metadata.
 * Uses a stable key (SESSIONS#userId + sessionId as timestamp/SK) to prevent duplicates.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @param sessionId - The session identifier.
 * @param meta - Partial conversation metadata to update.
 * @param workspaceId - Optional workspace identifier for isolation.
 * @returns A promise resolving when metadata is saved.
 * @since 2026-03-19
 */
export async function saveConversationMeta(
  base: BaseMemoryProvider,
  userId: string,
  sessionId: string,
  meta: Partial<ConversationMeta>,
  workspaceId?: string
): Promise<void> {
  const normalizedUserId = userId.replace(/^(SESSIONS#)+/, '');
  const { type } = await RetentionManager.getExpiresAt('SESSIONS', normalizedUserId);

  const isPinned = meta.isPinned === true;
  let expiresAt: number | undefined;

  if (isPinned) {
    // B1 Fix: Enforce maximum pinned session duration to prevent unbounded storage growth
    // Pinned sessions now have a max TTL of 365 days (configurable via RETENTION.MAX_PINNED_SESSION_DAYS)
    const maxPinnedTTLSeconds = RETENTION.MAX_PINNED_SESSION_DAYS * 24 * 60 * 60;
    expiresAt = Math.floor(Date.now() / 1000) + maxPinnedTTLSeconds;
    logger.info(
      `[Session] Pinned session will auto-expire in ${RETENTION.MAX_PINNED_SESSION_DAYS} days`,
      {
        userId: normalizedUserId,
        sessionId,
      }
    );
  } else {
    const retention = await RetentionManager.getExpiresAt('SESSIONS', normalizedUserId);
    expiresAt = retention.expiresAt;
  }

  let stableSortKey = sessionIdToSortKey(sessionId);

  const partitionKey = base.getScopedUserId(`SESSIONS#${normalizedUserId}`, workspaceId);

  const existingItems = await base.queryItems({
    KeyConditionExpression: 'userId = :pk AND #ts = :ts',
    ExpressionAttributeNames: {
      '#ts': 'timestamp',
    },
    ExpressionAttributeValues: {
      ':pk': partitionKey,
      ':ts': stableSortKey,
    },
  });

  if (existingItems.length > 0) {
    const existing = existingItems[0];
    const existingSessionId = existing.sessionId as string | undefined;
    if (existingSessionId && existingSessionId !== sessionId) {
      // Collision detected (same timestamp part, different sessionId)
      // Resolve by using the stable hash of the full sessionId
      stableSortKey = Number(fnv1aHash(sessionId));
    }
  }

  await base.updateItem({
    Key: {
      userId: partitionKey,
      timestamp: stableSortKey,
    },
    UpdateExpression:
      'SET sessionId = :sessionId, #tp = :type, expiresAt = :exp, title = :title, content = :content, isPinned = :pinned, updatedAt = :now, updatedAtNumeric = :now, workspaceId = :workspaceId',
    ExpressionAttributeNames: {
      '#tp': 'type',
    },
    ExpressionAttributeValues: {
      ':sessionId': sessionId,
      ':type': type,
      ':exp': expiresAt ?? null,
      ':title': meta.title || 'New Conversation',
      ':content': meta.lastMessage || '',
      ':pinned': isPinned,
      ':now': Date.now(),
      ':workspaceId': workspaceId ?? null,
    },
  });
}

// Move delete registered types

/**
 * Saves the Last Known Good (LKG) commit hash after a successful health check.
 *
 * @param base - The base memory provider instance.
 * @param hash - The Git commit hash or reference string.
 * @returns A promise resolving when the hash is saved.
 */
export async function saveLKGHash(base: BaseMemoryProvider, hash: string): Promise<void> {
  const { expiresAt, type } = await RetentionManager.getExpiresAt('DISTILLED', 'SYSTEM#LKG');
  await base.putItem({
    userId: 'SYSTEM#LKG',
    timestamp: Date.now(),
    type,
    expiresAt,
    content: hash,
  });
}

/**
 * Retrieves the most recent Last Known Good (LKG) commit hash.
 *
 * @param base - The base memory provider instance.
 * @returns A promise resolving to the latest LKG hash or null if not found.
 * @since 2026-03-19
 */
export async function getLatestLKGHash(base: BaseMemoryProvider): Promise<string | null> {
  const results = await queryLatestContentByUserId(base, 'SYSTEM#LKG', 1);
  return results[0] ?? null;
}

/**
 * Atomically increments the system-wide recovery attempt count.
 *
 * @param base - The base memory provider instance.
 * @returns A promise resolving to the new recovery attempt count.
 */
export async function incrementRecoveryAttemptCount(base: BaseMemoryProvider): Promise<number> {
  const result = await base.updateItem({
    Key: {
      userId: 'SYSTEM#RECOVERY#STATS',
      timestamp: 0,
    },
    UpdateExpression: 'SET attempts = if_not_exists(attempts, :zero) + :one, updatedAt = :now',
    ExpressionAttributeValues: {
      ':zero': 0,
      ':one': 1,
      ':now': Date.now(),
    },
    ReturnValues: 'ALL_NEW',
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attributes = (result as Record<string, any>).Attributes;
  return (attributes?.attempts as number) ?? 1;
}

/**
 * Resets the system-wide recovery attempt count.
 *
 * @param base - The base memory provider instance.
 * @returns A promise resolving when the counter is reset.
 */
export async function resetRecoveryAttemptCount(base: BaseMemoryProvider): Promise<void> {
  await base.updateItem({
    Key: {
      userId: 'SYSTEM#RECOVERY#STATS',
      timestamp: 0,
    },
    UpdateExpression: 'SET attempts = :zero, updatedAt = :now',
    ExpressionAttributeValues: {
      ':zero': 0,
      ':now': Date.now(),
    },
  });
}

/**
 * Retrieves the latest summary for a conversation session.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier or conversation ID.
 * @param workspaceId - Optional workspace identifier for isolation.
 * @returns A promise resolving to the summary string or null if not found.
 */
export async function getSummary(
  base: BaseMemoryProvider,
  userId: string,
  workspaceId?: string
): Promise<string | null> {
  const scopedUserId = base.getScopedUserId(`SUMMARY#${userId}`, workspaceId);
  const results = await queryLatestContentByUserId(base, scopedUserId, 1);
  return results[0] ?? null;
}

/**
 * Saves a distilled recovery log for agent context.
 *
 * @param base - The base memory provider instance.
 * @param traceId - The trace identifier.
 * @param log - The distilled recovery log content.
 * @returns A promise resolving when the log is saved.
 */
export async function saveDistilledRecoveryLog(
  base: BaseMemoryProvider,
  traceId: string,
  log: string
): Promise<void> {
  const { expiresAt, type } = await RetentionManager.getExpiresAt('DISTILLED', 'SYSTEM#RECOVERY');
  await base.putItem({
    userId: 'DISTILLED#RECOVERY',
    timestamp: Date.now(),
    type,
    expiresAt,
    content: log,
    traceId,
  });
}

/**
 * Updates the latest summary for a conversation session.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier or conversation ID.
 * @param summary - The summary string to store.
 * @param workspaceId - Optional workspace identifier for isolation.
 * @returns A promise resolving when the summary is updated.
 */
export async function updateSummary(
  base: BaseMemoryProvider,
  userId: string,
  summary: string,
  workspaceId?: string
): Promise<void> {
  const { expiresAt } = await RetentionManager.getExpiresAt('SESSIONS', userId);
  const scopedUserId = base.getScopedUserId(`SUMMARY#${userId}`, workspaceId);
  await base.putItem({
    userId: scopedUserId,
    timestamp: Date.now(),
    type: 'SUMMARY',
    expiresAt,
    content: summary,
    workspaceId,
  });
}
