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

/**
 * Appends a new message with tiered retention.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @param message - The message object to add.
 * @returns A promise resolving when the message is added.
 */
export async function addMessage(
  base: BaseMemoryProvider,
  userId: string,
  message: Message
): Promise<void> {
  const { expiresAt, type } = await RetentionManager.getExpiresAt('MESSAGES', userId);
  const scrubbedMessage = filterPIIFromObject(message);
  await base.putItem({
    userId,
    timestamp: Date.now(),
    type,
    expiresAt,
    ...scrubbedMessage,
  });
}

/**
 * Deletes a conversation session and its history.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @param sessionId - The session identifier to delete.
 * @returns A promise resolving when the conversation is deleted.
 */
export async function deleteConversation(
  base: BaseMemoryProvider,
  userId: string,
  sessionId: string
): Promise<void> {
  const normalizedUserId = userId.replace(/^(SESSIONS#)+/, '');
  const conversations = await base.listConversations(normalizedUserId);
  const existing = conversations.find((c) => c.sessionId === sessionId);

  if (existing) {
    await base.deleteItem({
      userId: `SESSIONS#${normalizedUserId}`,
      timestamp: existing.updatedAt,
    });
  }

  await base.clearHistory(`CONV#${normalizedUserId}#${sessionId}`);
}

/**
 * Updates distilled memory with a 2-year retention policy.
 * Uses a fixed timestamp (0) to ensure we only keep the latest version per user.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @param facts - The distilled facts string to store.
 * @returns A promise resolving when memory is updated.
 */
export async function updateDistilledMemory(
  base: BaseMemoryProvider,
  userId: string,
  facts: string
): Promise<void> {
  const normalizedUserId = userId.replace(/^(DISTILLED#)+/, '');
  const { expiresAt } = await RetentionManager.getExpiresAt('DISTILLED', normalizedUserId);
  await base.putItem({
    userId: `DISTILLED#${normalizedUserId}`,
    timestamp: 0,
    type: 'DISTILLED',
    expiresAt,
    content: facts,
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
 * @returns A promise resolving when metadata is saved.
 * @since 2026-03-19
 */
export async function saveConversationMeta(
  base: BaseMemoryProvider,
  userId: string,
  sessionId: string,
  meta: Partial<ConversationMeta>
): Promise<void> {
  const normalizedUserId = userId.replace(/^(SESSIONS#)+/, '');
  const { type } = await RetentionManager.getExpiresAt('SESSIONS', normalizedUserId);

  const isPinned = meta.isPinned === true;
  let expiresAt: number;

  if (isPinned) {
    expiresAt = 0;
  } else {
    const retention = await RetentionManager.getExpiresAt('SESSIONS', normalizedUserId);
    expiresAt = retention.expiresAt;
  }

  // Use UpdateCommand to atomically set or update session metadata.
  // We use the sessionId directly as part of the userId/PartitionKey or a unique timestamp
  // but to keep current listConversations (query by userId) working,
  // we'll use a deterministic timestamp derived from sessionId if possible,
  // or just use a stable identifier.
  // Actually, listConversations queries by 'SESSIONS#userId'.
  // If we want it to be unique per sessionId, we should use sessionId as the sort key (timestamp).

  // Convert sessionId to a numeric-ish value if it's a timestamp, otherwise use hash
  let stableTimestamp = Number.parseInt(sessionId.split('_')[1] || sessionId, 10);
  if (Number.isNaN(stableTimestamp)) {
    // Fallback to a hash-based numeric value if sessionId is not timestamp-based
    stableTimestamp = sessionId.split('').reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0);
  }

  await base.updateItem({
    Key: {
      userId: `SESSIONS#${normalizedUserId}`,
      timestamp: Math.abs(stableTimestamp),
    },
    UpdateExpression:
      'SET sessionId = :sessionId, #tp = :type, expiresAt = :exp, title = :title, content = :content, isPinned = :pinned, updatedAt = :now',
    ExpressionAttributeNames: {
      '#tp': 'type',
    },
    ExpressionAttributeValues: {
      ':sessionId': sessionId,
      ':type': type,
      ':exp': expiresAt,
      ':title': meta.title || 'New Conversation',
      ':content': meta.lastMessage || '',
      ':pinned': isPinned,
      ':now': Date.now(),
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
 * @returns A promise resolving to the summary string or null if not found.
 */
export async function getSummary(base: BaseMemoryProvider, userId: string): Promise<string | null> {
  const results = await queryLatestContentByUserId(base, `SUMMARY#${userId}`, 1);
  return results[0] ?? null;
}

/**
 * Updates the latest summary for a conversation session.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier or conversation ID.
 * @param summary - The summary string to store.
 * @returns A promise resolving when the summary is updated.
 */
export async function updateSummary(
  base: BaseMemoryProvider,
  userId: string,
  summary: string
): Promise<void> {
  const { expiresAt } = await RetentionManager.getExpiresAt('SESSIONS', userId);
  await base.putItem({
    userId: `SUMMARY#${userId}`,
    timestamp: Date.now(),
    type: 'SUMMARY',
    expiresAt,
    content: summary,
  });
}
