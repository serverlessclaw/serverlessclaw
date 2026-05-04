import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { Message, MessageRole } from '../types/llm';
import { ConversationMeta } from '../types/memory';
import { BaseMemoryProvider } from './base';

/**
 * Standard implementation for getHistory.
 * Filters out expired items based on TTL.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier to retrieve history for.
 * @param scope - Optional scope identifier or ContextualScope for isolation.
 * @returns A promise resolving to an array of Message objects.
 */
export async function getHistory(
  base: BaseMemoryProvider,
  userId: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<Message[]> {
  const scopedUserId = base.getScopedUserId(userId, scope);
  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': scopedUserId,
    },
    ScanIndexForward: true, // Oldest first
  });

  const now = Math.floor(Date.now() / 1000); // Current time in seconds for TTL comparison
  const validItems = (items || []).filter(
    (item) => !item.expiresAt || (item.expiresAt as number) > now
  );

  return validItems.map((item) => ({
    role: item.role as MessageRole,
    content: (item.content as string) ?? '',
    thought: item.thought as string | undefined,
    tool_calls: (item.tool_calls as import('./../types/llm').ToolCall[] | undefined) ?? [],
    attachments: (item.attachments as import('./../types/agent').Attachment[] | undefined) ?? [],
    tool_call_id: item.tool_call_id as string | undefined,
    name: item.name as string | undefined,
    agentName: item.agentName as string | undefined,
    traceId: (item.traceId as string) || `legacy-${item.timestamp || Date.now()}`,
    messageId: (item.messageId as string) || `msg-legacy-${item.timestamp || Date.now()}`,
  }));
}

/**
 * Standard implementation for clearHistory.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier to clear history for.
 * @param scope - Optional scope identifier or ContextualScope for isolation.
 * @returns A promise resolving when history is cleared.
 */
export async function clearHistory(
  base: BaseMemoryProvider,
  userId: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const tableName = base.getTableName();
  if (!tableName) return;

  const scopedUserId = base.getScopedUserId(userId, scope);
  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': scopedUserId,
    },
  });

  if (items.length === 0) return;

  // Batch delete in groups of 25 (DynamoDB limit)
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    let requestItems: import('../types/common').DynamoDBBatchWriteRequest = {
      [tableName]: batch.map((item) => ({
        DeleteRequest: {
          Key: { userId: item.userId as string, timestamp: item.timestamp as number },
        },
      })),
    };

    // Retry loop for unprocessed items (throughput throttling)
    let attempts = 0;
    const MAX_ATTEMPTS = 5;

    while (Object.keys(requestItems).length > 0 && attempts < MAX_ATTEMPTS) {
      if (attempts > 0) {
        const delay = Math.pow(2, attempts) * 100 + Math.random() * 100;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const response = await base
        .getDocClient()
        .send(new BatchWriteCommand({ RequestItems: requestItems }));
      requestItems = (response.UnprocessedItems as typeof requestItems) ?? {};
      attempts++;
    }

    if (Object.keys(requestItems).length > 0) {
      logger.error(
        `Failed to clear all history for ${scopedUserId} after ${MAX_ATTEMPTS} attempts.`,
        {
          unprocessedCount: Object.keys(requestItems[tableName] || {}).length,
        }
      );
    }
  }
  logger.info(`Cleared history for ${scopedUserId} (${items.length} items)`);
}

/**
 * Standard implementation for getDistilledMemory.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier to retrieve distilled memory for.
 * @param scope - Optional scope identifier or ContextualScope for isolation.
 * @returns A promise resolving to the distilled memory string.
 */
export async function getDistilledMemory(
  base: BaseMemoryProvider,
  userId: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<string> {
  const scopedDistilledId = base.getScopedUserId(`DISTILLED#${userId}`, scope);
  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': scopedDistilledId,
    },
    ScanIndexForward: false, // Latest first
    Limit: 1,
  });

  return (items?.[0]?.content as string) ?? '';
}

/**
 * Standard implementation for listConversations.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier to list conversations for.
 * @param scope - Optional scope identifier or ContextualScope for isolation.
 * @returns A promise resolving to an array of ConversationMeta objects.
 */
export async function listConversations(
  base: BaseMemoryProvider,
  userId: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<ConversationMeta[]> {
  const scopedSessionsId = base.getScopedUserId(`SESSIONS#${userId}`, scope);
  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': scopedSessionsId,
    },
    ScanIndexForward: false, // Newest first
  });

  return items.map((item) => ({
    sessionId: item.sessionId as string,
    title: item.title as string,
    lastMessage: item.content as string,
    updatedAt: item.timestamp as number | string,
    isPinned: !!item.isPinned,
    expiresAt: item.expiresAt as number | undefined,
  }));
}
/**
 * Utility to derive a workspace-scoped userId for DynamoDB partition keys.
 */
