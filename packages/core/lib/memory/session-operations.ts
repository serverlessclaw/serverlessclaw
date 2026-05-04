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
import { queryLatestContentByUserId, atomicIncrement, putWithCollisionRetry } from './utils';
import { RETENTION } from '../constants/memory';
import { sessionIdToSortKey, fnv1aHash } from '../utils/id-generator';

/**
 * Appends a new message with tiered retention.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @param message - The message object to add.
 * @param scope - Optional scope identifier or ContextualScope object for isolation.
 * @returns A promise resolving when the message is added.
 */
export async function addMessage(
  base: BaseMemoryProvider,
  userId: string,
  message: Message,
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const scopedUserId = base.getScopedUserId(userId, scope);
  const { expiresAt, type } = await RetentionManager.getExpiresAt('MESSAGES', scopedUserId);
  const scrubbedMessage = filterPIIFromObject(message);

  let workspaceId: string | undefined;
  if (typeof scope === 'string') {
    workspaceId = scope;
  } else if (scope) {
    workspaceId = scope.workspaceId;
  }

  await base.putItem({
    userId: scopedUserId,
    timestamp: Date.now(),
    createdAt: Date.now(),
    type,
    expiresAt,
    workspaceId: workspaceId || undefined,
    ...scrubbedMessage,
  });
}

/**
 * Deletes a conversation session and its history.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @param sessionId - The session identifier to delete.
 * @param scope - Optional scope identifier or ContextualScope object for isolation.
 * @returns A promise resolving when the conversation is deleted.
 */
export async function deleteConversation(
  base: BaseMemoryProvider,
  userId: string,
  sessionId: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const normalizedUserId = userId.replace(/^(SESSIONS#)+/, '');
  // We must list conversations to find the exact Sort Key (timestamp) for the session,
  // as saveConversationMeta may append collision suffixes that cannot be derived.
  const conversations = await base.listConversations(normalizedUserId, scope);
  const existing = conversations.find((c) => c.sessionId === sessionId);

  if (existing) {
    const scopedSessionsId = base.getScopedUserId(`SESSIONS#${normalizedUserId}`, scope);
    await base.deleteItem({
      userId: scopedSessionsId,
      timestamp: existing.updatedAt, // existing.updatedAt maps to the 'timestamp' SK attribute
    });
  }

  // Clear message history (Keyed by CONV#userId#sessionId)
  await base.clearHistory(`CONV#${normalizedUserId}#${sessionId}`, scope);
}

/**
 * Updates distilled memory with a 2-year retention policy.
 * Uses a fixed timestamp (0) to ensure we only keep the latest version per user.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @param facts - The distilled facts string to store.
 * @param scope - Optional scope identifier or ContextualScope object for isolation.
 * @returns A promise resolving when memory is updated.
 */
export async function updateDistilledMemory(
  base: BaseMemoryProvider,
  userId: string,
  facts: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const normalizedUserId = userId.replace(/^(DISTILLED#)+/, '');
  const scopedUserId = base.getScopedUserId(`DISTILLED#${normalizedUserId}`, scope);
  const { expiresAt } = await RetentionManager.getExpiresAt('DISTILLED', normalizedUserId);

  let workspaceId: string | undefined;
  if (typeof scope === 'string') {
    workspaceId = scope;
  } else if (scope) {
    workspaceId = scope.workspaceId;
  }

  await base.updateItem({
    Key: {
      userId: scopedUserId,
      timestamp: 0,
    },
    UpdateExpression: 'SET #tp = :type, expiresAt = :exp, content = :content, workspaceId = :wid',
    ExpressionAttributeNames: { '#tp': 'type' },
    ExpressionAttributeValues: {
      ':type': 'DISTILLED',
      ':exp': expiresAt,
      ':content': facts,
      ':wid': workspaceId || 'global',
    },
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
 * @param scope - Optional scope identifier or ContextualScope object for isolation.
 * @returns A promise resolving when metadata is saved.
 * @since 2026-03-19
 */
export async function saveConversationMeta(
  base: BaseMemoryProvider,
  userId: string,
  sessionId: string,
  meta: Partial<ConversationMeta>,
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const normalizedUserId = userId.replace(/^(SESSIONS#)+/, '');
  const { type } = await RetentionManager.getExpiresAt('SESSIONS', normalizedUserId);

  const partitionKey = base.getScopedUserId(`SESSIONS#${normalizedUserId}`, scope);
  const sortKeyBase = sessionIdToSortKey(sessionId);
  let stableSortKey = sortKeyBase;

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

  const existing = existingItems.length > 0 ? existingItems[0] : null;
  if (existing && (existing.sessionId as string | undefined) && existing.sessionId !== sessionId) {
    // Collision detected (same timestamp part, different sessionId)
    // Resolve by using the stable hash of the full sessionId
    stableSortKey = Number(fnv1aHash(sessionId));
  }

  const updateExprParts: string[] = [
    'sessionId = :sessionId',
    '#tp = :type',
    'updatedAt = :now',
    'updatedAtNumeric = :now',
  ];
  const attrNames: Record<string, string> = { '#tp': 'type' };
  const attrValues: Record<string, unknown> = {
    ':sessionId': sessionId,
    ':type': type,
    ':now': meta.updatedAt ?? Date.now(),
  };

  // Only update isPinned and expiresAt if explicitly provided or if it's a new session
  if (meta.isPinned !== undefined) {
    updateExprParts.push('isPinned = :pinned');
    attrValues[':pinned'] = meta.isPinned;

    if (meta.isPinned) {
      const maxPinnedTTLSeconds = RETENTION.MAX_PINNED_SESSION_DAYS * 24 * 60 * 60;
      attrValues[':exp'] = Math.floor(Date.now() / 1000) + maxPinnedTTLSeconds;
    } else {
      const retention = await RetentionManager.getExpiresAt('SESSIONS', normalizedUserId);
      attrValues[':exp'] = retention.expiresAt;
    }
    updateExprParts.push('expiresAt = :exp');
  }

  if (meta.title !== undefined) {
    updateExprParts.push('title = :title');
    attrValues[':title'] = meta.title;
  }
  if (meta.lastMessage !== undefined) {
    updateExprParts.push('content = :content');
    attrValues[':content'] = meta.lastMessage;
  }
  if (meta.mission !== undefined) {
    updateExprParts.push('mission = :mission');
    attrValues[':mission'] = meta.mission;
  }

  let workspaceId: string | undefined;
  if (typeof scope === 'string') {
    workspaceId = scope;
  } else if (scope) {
    workspaceId = scope.workspaceId;
  }
  if (workspaceId) {
    updateExprParts.push('workspaceId = :workspaceId');
    attrValues[':workspaceId'] = workspaceId;
  }

  // For NEW sessions, ensure defaults are set
  if (!existing) {
    if (meta.title === undefined) {
      updateExprParts.push('title = :defaultTitle');
      attrValues[':defaultTitle'] = 'New Conversation';
    }
    if (meta.lastMessage === undefined) {
      updateExprParts.push('content = :defaultContent');
      attrValues[':defaultContent'] = '';
    }
    if (meta.isPinned === undefined) {
      updateExprParts.push('isPinned = :defaultPinned');
      attrValues[':defaultPinned'] = false;
      const retention = await RetentionManager.getExpiresAt('SESSIONS', normalizedUserId);
      updateExprParts.push('expiresAt = :defaultExp');
      attrValues[':defaultExp'] = retention.expiresAt;
    }
  }

  await base.updateItem({
    Key: {
      userId: partitionKey,
      timestamp: stableSortKey,
    },
    UpdateExpression: `SET ${updateExprParts.join(', ')}`,
    ExpressionAttributeNames: attrNames,
    ExpressionAttributeValues: attrValues,
  });
}

// Move delete registered types

/**
 * Saves the Last Known Good (LKG) commit hash after a successful health check.
 *
 * @param base - The base memory provider instance.
 * @param hash - The Git commit hash or reference string.
 * @param scope - Optional scope identifier for isolation.
 * @returns A promise resolving when the hash is saved.
 */
export async function saveLKGHash(
  base: BaseMemoryProvider,
  hash: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const pk = base.getScopedUserId('SYSTEM#LKG', scope);
  const workspaceId = typeof scope === 'string' ? scope : scope?.workspaceId;
  const { expiresAt, type } = await RetentionManager.getExpiresAt('DISTILLED', pk);

  await putWithCollisionRetry(base, {
    userId: pk,
    type,
    expiresAt,
    content: hash,
    workspaceId: workspaceId || undefined,
  });
}

/**
 * Retrieves the most recent Last Known Good (LKG) commit hash.
 *
 * @param base - The base memory provider instance.
 * @param scope - Optional scope identifier for isolation.
 * @returns A promise resolving to the latest LKG hash or null if not found.
 * @since 2026-03-19
 */
export async function getLatestLKGHash(
  base: BaseMemoryProvider,
  scope?: string | import('../types/memory').ContextualScope
): Promise<string | null> {
  const pk = base.getScopedUserId('SYSTEM#LKG', scope);
  const results = await queryLatestContentByUserId(base, pk, 1);
  return results[0] ?? null;
}

/**
 * Atomically increments the system-wide recovery attempt count.
 *
 * @param base - The base memory provider instance.
 * @param scope - Optional scope identifier for isolation.
 * @returns A promise resolving to the new recovery attempt count.
 */
export async function incrementRecoveryAttemptCount(
  base: BaseMemoryProvider,
  scope?: string | import('../types/memory').ContextualScope
): Promise<number> {
  const pk = base.getScopedUserId('SYSTEM#RECOVERY#STATS', scope);
  return atomicIncrement(base, pk, 0, 'attempts', false);
}

/**
 * Resets the system-wide recovery attempt count.
 *
 * @param base - The base memory provider instance.
 * @param scope - Optional scope identifier for isolation.
 * @returns A promise resolving when the counter is reset.
 */
export async function resetRecoveryAttemptCount(
  base: BaseMemoryProvider,
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const pk = base.getScopedUserId('SYSTEM#RECOVERY#STATS', scope);
  await base.updateItem({
    Key: {
      userId: pk,
      timestamp: 0,
    },
    UpdateExpression: 'SET #field = :zero, updatedAt = :now',
    ExpressionAttributeNames: { '#field': 'attempts' },
    ExpressionAttributeValues: {
      ':zero': 0,
      ':now': Date.now(),
    },
    ConditionExpression: 'attribute_exists(userId)', // Only reset if exists
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
  scope?: string | import('../types/memory').ContextualScope
): Promise<string | null> {
  const scopedUserId = base.getScopedUserId(`SUMMARY#${userId}`, scope);
  const results = await queryLatestContentByUserId(base, scopedUserId, 1);
  return results[0] ?? null;
}

/**
 * Saves a distilled recovery log for agent context.
 *
 * @param base - The base memory provider instance.
 * @param traceId - The trace identifier.
 * @param log - The distilled recovery log content.
 * @param scope - Optional scope identifier for isolation.
 * @returns A promise resolving when the log is saved.
 */
export async function saveDistilledRecoveryLog(
  base: BaseMemoryProvider,
  traceId: string,
  log: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const pk = base.getScopedUserId('DISTILLED#RECOVERY', scope);
  const workspaceId = typeof scope === 'string' ? scope : scope?.workspaceId;
  const { expiresAt, type } = await RetentionManager.getExpiresAt('DISTILLED', pk);

  await putWithCollisionRetry(base, {
    userId: pk,
    type,
    expiresAt,
    content: log,
    traceId,
    workspaceId: workspaceId || undefined,
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
  scope?: string | import('../types/memory').ContextualScope
): Promise<void> {
  const { expiresAt } = await RetentionManager.getExpiresAt('SESSIONS', userId);
  const scopedUserId = base.getScopedUserId(`SUMMARY#${userId}`, scope);

  let workspaceId: string | undefined;
  if (typeof scope === 'string') {
    workspaceId = scope;
  } else if (scope) {
    workspaceId = scope.workspaceId;
  }

  await base.putItem(
    {
      userId: scopedUserId,
      timestamp: Date.now(),
      type: 'SUMMARY',
      expiresAt,
      content: summary,
      workspaceId: workspaceId || undefined,
    },
    {
      ConditionExpression: 'attribute_not_exists(userId) AND attribute_not_exists(#ts)',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
    }
  );
}

/**
 * Retrieves metadata for a specific conversation session.
 *
 * @param base - The base memory provider instance.
 * @param sessionId - The session identifier.
 * @param scope - Optional scope identifier for isolation.
 * @returns A promise resolving to the session metadata or null if not found.
 */
export async function getSessionMetadata(
  base: BaseMemoryProvider,
  sessionId: string,
  scope?: string | import('../types/memory').ContextualScope
): Promise<ConversationMeta | null> {
  const pk = base.getScopedUserId(`SESSIONS#${sessionId}`, scope);
  const sortKey = sessionIdToSortKey(sessionId);

  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :pk AND #ts = :ts',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: {
      ':pk': pk,
      ':ts': sortKey,
    },
  });

  const item = items[0];
  if (!item) return null;

  return {
    sessionId: item.sessionId as string,
    title: item.title as string,
    lastMessage: item.content as string,
    updatedAt: item.timestamp as number | string,
    isPinned: !!item.isPinned,
    expiresAt: item.expiresAt as number | undefined,
    mission: item.mission as any,
    workspaceId: item.workspaceId as string,
    metadata: item.metadata as any,
  };
}
