/**
 * Session Operations Module
 *
 * Contains conversation, message, and session management methods for the DynamoMemory class.
 * These functions operate on a BaseMemoryProvider instance.
 */

import { Message, ConversationMeta } from '../types/index';
import { RetentionManager } from './tiering';
import type { BaseMemoryProvider } from './base';
import { filterPIIFromObject } from '../utils/pii';

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
  const conversations = await base.listConversations(userId);
  const existing = conversations.find((c) => c.sessionId === sessionId);

  if (existing) {
    await base.deleteItem({
      userId: `SESSIONS#${userId}`,
      timestamp: existing.updatedAt,
    });
  }

  await base.clearHistory(`CONV#${userId}#${sessionId}`);
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
  const { expiresAt } = await RetentionManager.getExpiresAt('DISTILLED', userId);
  await base.putItem({
    userId: `DISTILLED#${userId}`,
    timestamp: 0,
    type: 'DISTILLED',
    expiresAt,
    content: facts,
  });
}

/**
 * Saves or updates session metadata.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @param sessionId - The session identifier.
 * @param meta - Partial conversation metadata to update.
 * @returns A promise resolving when metadata is saved.
 */
export async function saveConversationMeta(
  base: BaseMemoryProvider,
  userId: string,
  sessionId: string,
  meta: Partial<ConversationMeta>
): Promise<void> {
  const conversations = await base.listConversations(userId);
  const existing = conversations.find((c) => c.sessionId === sessionId);

  if (existing) {
    await base.deleteItem({
      userId: `SESSIONS#${userId}`,
      timestamp: existing.updatedAt,
    });
  }

  const isPinned = meta.isPinned !== undefined ? meta.isPinned : existing?.isPinned || false;

  let expiresAt: number | undefined;
  if (isPinned) {
    // Pinned items do not expire (effectively)
    expiresAt = 0;
  } else {
    const retention = await RetentionManager.getExpiresAt('SESSIONS', userId);
    expiresAt = retention.expiresAt;
  }

  const { type } = await RetentionManager.getExpiresAt('SESSIONS', userId);

  await base.putItem({
    userId: `SESSIONS#${userId}`,
    timestamp: Date.now(),
    type,
    expiresAt,
    sessionId,
    isPinned,
    title: meta.title || existing?.title || 'New Conversation',
    content: meta.lastMessage || existing?.lastMessage || '',
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
 */
export async function getLatestLKGHash(base: BaseMemoryProvider): Promise<string | null> {
  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': 'SYSTEM#LKG',
    },
    Limit: 1,
    ScanIndexForward: false,
  });

  return (items[0]?.content as string) || null;
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

  return (result.Attributes?.attempts as number) ?? 1;
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
