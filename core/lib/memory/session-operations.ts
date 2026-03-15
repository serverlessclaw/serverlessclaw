/**
 * Session Operations Module
 *
 * Contains conversation, message, and session management methods for the DynamoMemory class.
 * These functions operate on a BaseMemoryProvider instance.
 */

import { Message, ConversationMeta } from '../types/index';
import { RetentionManager } from './tiering';
import type { BaseMemoryProvider } from './base';

/**
 * Appends a new message with tiered retention.
 */
export async function addMessage(
  base: BaseMemoryProvider,
  userId: string,
  message: Message
): Promise<void> {
  const { expiresAt, type } = await RetentionManager.getExpiresAt('MESSAGES', userId);
  await base.putItem({
    userId,
    timestamp: Date.now(),
    type,
    expiresAt,
    ...message,
  });
}

/**
 * Deletes a conversation session and its history
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
 * Updates distilled memory with a 2-year retention policy
 */
export async function updateDistilledMemory(
  base: BaseMemoryProvider,
  userId: string,
  facts: string
): Promise<void> {
  const { expiresAt, type } = await RetentionManager.getExpiresAt('DISTILLED', userId);
  await base.putItem({
    userId: `DISTILLED#${userId}`,
    timestamp: Date.now(),
    type,
    expiresAt,
    content: facts,
  });
}

/**
 * Saves or updates session metadata
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

  const { expiresAt, type } = await RetentionManager.getExpiresAt('SESSIONS', userId);
  await base.putItem({
    userId: `SESSIONS#${userId}`,
    timestamp: Date.now(),
    type,
    expiresAt,
    sessionId,
    title: meta.title || existing?.title || 'New Conversation',
    content: meta.lastMessage || existing?.lastMessage || '',
  });
}

/**
 * Universal fetcher for memory items by their type using the GSI.
 */
export async function getMemoryByType(
  base: BaseMemoryProvider,
  type: string,
  limit: number = 100
): Promise<Record<string, unknown>[]> {
  return (await base.queryItems({
    IndexName: 'TypeTimestampIndex',
    KeyConditionExpression: '#type = :type',
    ExpressionAttributeNames: {
      '#type': 'type',
    },
    ExpressionAttributeValues: {
      ':type': type,
    },
    ScanIndexForward: false,
    Limit: limit,
  })) as Record<string, unknown>[];
}

/**
 * Saves the Last Known Good (LKG) commit hash after a successful health check.
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
