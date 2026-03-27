/**
 * Insight Operations Module
 *
 * Contains insight and lesson management methods for the DynamoMemory class.
 * These functions operate on a BaseMemoryProvider instance.
 */

import { MemoryInsight, InsightMetadata, InsightCategory } from '../types/memory';
import { RetentionManager } from './tiering';
import type { BaseMemoryProvider } from './base';
import { filterPII } from '../utils/pii';
import {
  createMetadata,
  queryLatestContentByUserId,
  queryByTypeAndGetContent,
  queryByTypeAndMap,
} from './utils';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Shared implementation for adding granular records (Insights/Memories).
 *
 * @param base - The base memory provider instance.
 * @param baseCategory - The primary category (e.g., 'MEMORY').
 * @param scopeId - The scope identifier (user or system).
 * @param category - The specific insight category.
 * @param content - The textual content of the memory.
 * @param metadata - Optional additional metadata.
 * @returns A promise resolving to the timestamp of the record.
 */
async function addRecord(
  base: BaseMemoryProvider,
  baseCategory: 'MEMORY',
  scopeId: string,
  category: InsightCategory | string,
  content: string,
  metadata?: Partial<InsightMetadata>
): Promise<number> {
  const { expiresAt } = await RetentionManager.getExpiresAt(baseCategory, scopeId);
  const timestamp = Date.now();
  const scrubbedContent = filterPII(content);
  // Unify all flexible memory under the MEMORY: prefix for 2026 simplicity
  const fullType = `MEMORY:${category.toUpperCase()}`;

  // 1. Register the type atomically so it can be dynamically discovered by the dashboard
  try {
    await base.updateItem({
      Key: {
        userId: 'SYSTEM#REGISTRY',
        timestamp: 0,
      },
      UpdateExpression: 'ADD activeTypes :type',
      ExpressionAttributeValues: {
        ':type': new Set([fullType]),
      },
    });
  } catch {
    // Silent fail if registry update fails to not break memory insertion
  }

  // 2. Insert the actual memory record
  await base.putItem({
    userId: scopeId,
    timestamp,
    type: fullType,
    expiresAt,
    content: scrubbedContent,
    metadata: createMetadata(
      {
        category,
        ...(metadata ?? {}),
      },
      timestamp
    ),
  });
  return timestamp;
}

/**
 * Atomically increments the hit count and updates the lastAccessed timestamp for a memory item.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier or scope.
 * @param timestamp - The unique timestamp of the memory item.
 * @returns A promise resolving when the hit is recorded.
 */
export async function recordMemoryHit(
  base: BaseMemoryProvider,
  userId: string,
  timestamp: number
): Promise<void> {
  try {
    await base.updateItem({
      Key: { userId, timestamp },
      UpdateExpression:
        'SET metadata.hitCount = if_not_exists(metadata.hitCount, :zero) + :inc, metadata.lastAccessed = :now',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':inc': 1,
        ':now': Date.now(),
      },
      ConditionExpression: 'attribute_exists(userId)',
    });
  } catch (e: unknown) {
    // Silent failure so it doesn't interrupt tool execution if the memory item was just deleted or schema is legacy
    console.warn(`Failed to record memory hit for ${userId}@${timestamp}`, e);
  }
}

/**
 * Adds a tactical lesson.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @param lesson - The lesson content.
 * @param metadata - Optional insight metadata.
 * @returns A promise resolving when the lesson is added.
 * @since 2026-03-19
 */
export async function addLesson(
  base: BaseMemoryProvider,
  userId: string,
  lesson: string,
  metadata?: InsightMetadata
): Promise<void> {
  const { expiresAt, type } = await RetentionManager.getExpiresAt('LESSON', userId);
  const timestamp = Date.now();
  const normalizedUserId = userId.replace(/^(LESSON#)+/, '');
  await base.putItem({
    userId: `LESSON#${normalizedUserId}`,
    timestamp,
    type,
    expiresAt,
    content: filterPII(lesson),
    metadata: createMetadata(metadata ?? { category: InsightCategory.TACTICAL_LESSON }, timestamp),
  });
}

/**
 * Retrieves recent tactical lessons.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier.
 * @returns A promise resolving to an array of lesson content strings.
 */
export async function getLessons(base: BaseMemoryProvider, userId: string): Promise<string[]> {
  const normalizedUserId = userId.replace(/^(LESSON#)+/, '');
  return queryLatestContentByUserId(base, `LESSON#${normalizedUserId}`, 10);
}

// =============================================================================
// GAP #5 FIX: Cross-Session Knowledge — Global Lessons Namespace
// =============================================================================

const GLOBAL_LESSON_PREFIX = 'SYSTEM_LESSON#';

/**
 * Adds a system-wide lesson that benefits ALL users and sessions.
 * These are discovered during cross-session analysis and represent
 * universal truths the swarm has learned.
 *
 * @param base - The base memory provider instance.
 * @param lesson - The lesson content (should not contain PII).
 * @param metadata - Optional insight metadata.
 * @returns The timestamp of the recorded global lesson.
 */
export async function addGlobalLesson(
  base: BaseMemoryProvider,
  lesson: string,
  metadata?: Partial<InsightMetadata>
): Promise<number> {
  const { expiresAt } = await RetentionManager.getExpiresAt('LESSON', '');
  const timestamp = Date.now();
  await base.putItem({
    userId: `${GLOBAL_LESSON_PREFIX}${timestamp}`,
    timestamp,
    type: 'SYSTEM_LESSON',
    expiresAt,
    content: filterPII(lesson),
    metadata: createMetadata(
      {
        category: InsightCategory.SYSTEM_KNOWLEDGE,
        confidence: metadata?.confidence ?? 8,
        impact: metadata?.impact ?? 7,
        complexity: metadata?.complexity ?? 3,
        risk: metadata?.risk ?? 2,
        urgency: metadata?.urgency ?? 5,
        priority: metadata?.priority ?? 6,
      },
      timestamp
    ),
  });
  return timestamp;
}

/**
 * Retrieves system-wide lessons for injection into agent prompts.
 * These lessons apply to ALL users and represent the swarm's collective intelligence.
 *
 * @param base - The base memory provider instance.
 * @param limit - Maximum number of global lessons to return.
 * @returns An array of global lesson content strings.
 */
export async function getGlobalLessons(
  base: BaseMemoryProvider,
  limit: number = 10
): Promise<string[]> {
  return queryByTypeAndGetContent(base, 'SYSTEM_LESSON', limit);
}

/**
 * Adds a new granular memory item into the user or global scope.
 *
 * @param base - The base memory provider instance.
 * @param scopeId - The scope identifier (e.g., USER#id or SYSTEM#GLOBAL).
 * @param category - The memory category.
 * @param content - The memory content.
 * @param metadata - Optional insight metadata.
 * @returns A promise resolving to the timestamp of the new memory item.
 */
export async function addMemory(
  base: BaseMemoryProvider,
  scopeId: string,
  category: InsightCategory | string,
  content: string,
  metadata?: Partial<InsightMetadata>
): Promise<number> {
  return addRecord(base, 'MEMORY', scopeId, category, content, metadata);
}

import { getRegisteredMemoryTypes, getMemoryByType } from './utils';

/**
 * Searches for insights across all categories.
 *
 * @param base - The base memory provider instance.
 * @param userId - Optional user identifier to scope user-specific insights.
 * @param query - The search query string (supports '*' for all).
 * @param category - Optional category to filter results.
 * @param limit - Pagination limit.
 * @param lastEvaluatedKey - Pagination token.
 * @returns A promise resolving to an array of matching MemoryInsight objects and a pagination token.
 * @since 2026-03-19
 */
export async function searchInsights(
  base: BaseMemoryProvider,
  userId?: string,
  query: string = '',
  category?: InsightCategory,
  limit: number = 50,
  lastEvaluatedKey?: Record<string, unknown>
): Promise<{ items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const params: Record<string, any> = {
    Limit: limit,
    ExclusiveStartKey: lastEvaluatedKey,
  };

  // If we have a category, prefer the TypeTimestampIndex GSI as it's highly reliable
  if (category) {
    params.IndexName = 'TypeTimestampIndex';
    params.KeyConditionExpression = '#tp = :type';
    params.ExpressionAttributeNames = { '#tp': 'type' };
    params.ExpressionAttributeValues = { ':type': `MEMORY:${category.toUpperCase()}` };
    params.ScanIndexForward = false;

    const filters: string[] = [];
    if (userId) {
      filters.push('#uid = :userId');
      params.ExpressionAttributeNames['#uid'] = 'userId';
      params.ExpressionAttributeValues[':userId'] = userId;
    }
    if (query && query !== '*' && query !== '') {
      filters.push('contains(content, :query)');
      params.ExpressionAttributeValues[':query'] = query;
    }

    if (filters.length > 0) {
      params.FilterExpression = filters.join(' AND ');
    }

    const result = await base.queryItemsPaginated(params);
    return {
      items: mapToInsights(result.items as Record<string, unknown>[]),
      lastEvaluatedKey: result.lastEvaluatedKey,
    };
  }

  // Fallback for userId-only search (no category)
  if (userId) {
    params.KeyConditionExpression = '#uid = :userId';
    params.ExpressionAttributeNames = { '#uid': 'userId' };
    params.ExpressionAttributeValues = { ':userId': userId };
    params.ScanIndexForward = false;

    if (query && query !== '*' && query !== '') {
      params.FilterExpression = 'contains(content, :query)';
      params.ExpressionAttributeValues[':query'] = query;
    }

    const result = await base.queryItemsPaginated(params);
    return {
      items: mapToInsights(result.items as Record<string, unknown>[]),
      lastEvaluatedKey: result.lastEvaluatedKey,
    };
  }

  // Fallback to Scan for cross-user/global keyword search
  const filterExpressions: string[] = [];
  const expressionAttributeValues: Record<string, unknown> = {};
  const expressionAttributeNames: Record<string, string> = {};

  if (query && query !== '*' && query !== '') {
    filterExpressions.push('contains(content, :query)');
    expressionAttributeValues[':query'] = query;
  }

  if (filterExpressions.length > 0) {
    params.FilterExpression = filterExpressions.join(' AND ');
    params.ExpressionAttributeValues = expressionAttributeValues;
    if (Object.keys(expressionAttributeNames).length > 0) {
      params.ExpressionAttributeNames = expressionAttributeNames;
    }
  }

  const result = await (base as any).docClient.send(
    new ScanCommand({
      TableName: (base as any).tableName,
      ...params,
    })
  );

  const items = (result.Items ?? []) as Record<string, unknown>[];
  return {
    items: mapToInsights(items).sort((a, b) => b.timestamp - a.timestamp),
    lastEvaluatedKey: result.LastEvaluatedKey,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Helper to map DB items to MemoryInsight objects.
 */
function mapToInsights(items: Record<string, unknown>[]): MemoryInsight[] {
  return items.map((item) => {
    const scope = item.userId as string;
    const metadata = (item.metadata as InsightMetadata) ?? {
      category: scope.startsWith('DISTILLED')
        ? InsightCategory.USER_PREFERENCE
        : scope.startsWith('LESSON')
          ? InsightCategory.TACTICAL_LESSON
          : InsightCategory.STRATEGIC_GAP,
      confidence: 0,
      impact: 0,
      complexity: 0,
      risk: 0,
      urgency: 0,
      priority: 0,
    };

    return {
      id: scope,
      content: item.content as string,
      metadata,
      timestamp: item.timestamp as number,
    };
  });
}

/**
 * Updates metadata for a specific insight.
 *
 * @param base - The base memory provider instance.
 * @param userId - The user identifier or scope.
 * @param timestamp - The unique timestamp of the insight.
 * @param metadata - Partial metadata to update.
 * @returns A promise resolving when the metadata is updated.
 * @since 2026-03-19
 */
export async function updateInsightMetadata(
  base: BaseMemoryProvider,
  userId: string,
  timestamp: number,
  metadata: Partial<InsightMetadata>
): Promise<void> {
  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :userId AND #ts = :timestamp',
    ExpressionAttributeNames: {
      '#ts': 'timestamp',
    },
    ExpressionAttributeValues: {
      ':userId': userId,
      ':timestamp': timestamp,
    },
  });

  const item = items[0];
  if (!item) return;

  await base.putItem({
    ...item,
    metadata: { ...(item.metadata ?? {}), ...metadata },
  });
}

/**
 * Retrieves memory items with low utilization (low hitCount and old lastAccessed).
 * Scans dynamically registered memory types.
 *
 * @param base - The base memory provider instance.
 * @param limit - The maximum number of stale items to retrieve.
 * @returns A promise resolving to an array of low-utilization memory items.
 * @since 2026-03-19
 */
export async function getLowUtilizationMemory(
  base: BaseMemoryProvider,
  limit: number = 20
): Promise<Record<string, unknown>[]> {
  const registeredTypes = await getRegisteredMemoryTypes(base);
  let staleItems: Record<string, unknown>[] = [];
  const STALE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
  const now = Date.now();

  for (const type of registeredTypes) {
    if (!type.startsWith('MEMORY:') && type !== 'LESSON') continue;

    const items = await getMemoryByType(base, type, 50);

    const stale = items.filter((item: Record<string, unknown>) => {
      const meta = item.metadata as InsightMetadata | undefined;
      if (!meta) return false;

      const isHitCountLow = meta.hitCount === undefined || meta.hitCount === 0;
      const lastAccessed = meta.lastAccessed ?? (item.timestamp as number) ?? now;
      const timeSinceAccess = now - lastAccessed;

      return isHitCountLow && timeSinceAccess > STALE_THRESHOLD_MS;
    });

    staleItems = [...staleItems, ...stale];
  }

  // Sort by oldest first and cap
  return staleItems
    .sort((a, b) => {
      const tA =
        (a.metadata as Record<string, unknown>)?.lastAccessed ?? (a.timestamp as number) ?? 0;
      const tB =
        (b.metadata as Record<string, unknown>)?.lastAccessed ?? (b.timestamp as number) ?? 0;
      return (tA as number) - (tB as number);
    })
    .slice(0, limit);
}

/**
 * Records a failure pattern (tool misuse, hallucination, timeout, etc.)
 * for future cross-referencing by the cognition reflector and strategic planner.
 *
 * @param base - The base memory provider instance.
 * @param scopeId - The user or agent scope identifier.
 * @param content - Description of the failure pattern.
 * @param metadata - Optional metadata (confidence, impact, etc.).
 * @returns The timestamp of the recorded pattern.
 */
export async function recordFailurePattern(
  base: BaseMemoryProvider,
  scopeId: string,
  content: string,
  metadata?: Partial<InsightMetadata>
): Promise<number> {
  return addMemory(base, scopeId, InsightCategory.FAILURE_PATTERN, content, metadata);
}

/**
 * Retrieves failure patterns relevant to the given context.
 *
 * @param base - The base memory provider instance.
 * @param scopeId - The user or agent scope identifier.
 * @param context - Search context (keyword match against content). Use '*' for all.
 * @param limit - Maximum number of patterns to return.
 * @returns An array of matching failure pattern insights.
 */
export async function getFailurePatterns(
  base: BaseMemoryProvider,
  scopeId: string,
  context: string = '*',
  limit: number = 5
): Promise<MemoryInsight[]> {
  const { items } = await searchInsights(
    base,
    scopeId,
    context,
    InsightCategory.FAILURE_PATTERN,
    limit
  );
  return items;
}

// =============================================================================
// GAP #2 FIX: FAILED_PLANS# — Negative Memory Tier
// =============================================================================

/**
 * Records a failed strategic plan so the swarm learns what NOT to do.
 * Prevents the planner from retrying structurally identical failed approaches.
 *
 * @param base - The base memory provider instance.
 * @param planHash - A hash or summary of the failed plan for deduplication.
 * @param planContent - The full plan text that failed.
 * @param gapIds - The gap IDs this plan was meant to address.
 * @param failureReason - Why the plan failed (build error, QA rejection, etc.).
 * @param metadata - Optional insight metadata.
 * @returns The timestamp of the recorded failed plan.
 */
export async function recordFailedPlan(
  base: BaseMemoryProvider,
  planHash: string,
  planContent: string,
  gapIds: string[],
  failureReason: string,
  metadata?: Partial<InsightMetadata>
): Promise<number> {
  const { expiresAt } = await RetentionManager.getExpiresAt('MEMORY', '');
  const timestamp = Date.now();
  const content = JSON.stringify({
    planHash,
    planSummary: planContent.substring(0, 500),
    gapIds,
    failureReason,
    planLength: planContent.length,
  });

  await base.putItem({
    userId: `FAILED_PLAN#${planHash}`,
    timestamp,
    type: 'FAILED_PLAN',
    expiresAt,
    content,
    metadata: createMetadata(
      {
        category: InsightCategory.FAILURE_PATTERN,
        confidence: metadata?.confidence ?? 9,
        impact: metadata?.impact ?? 8,
        complexity: metadata?.complexity ?? 5,
        risk: metadata?.risk ?? 6,
        urgency: metadata?.urgency ?? 7,
        priority: metadata?.priority ?? 7,
      },
      timestamp
    ),
  });

  return timestamp;
}

/**
 * Retrieves previously failed plans to inform the planner about anti-patterns.
 *
 * @param base - The base memory provider instance.
 * @param limit - Maximum number of failed plans to return.
 * @returns An array of failed plan records.
 */
export async function getFailedPlans(
  base: BaseMemoryProvider,
  limit: number = 10
): Promise<MemoryInsight[]> {
  return queryByTypeAndMap(base, 'FAILED_PLAN', InsightCategory.FAILURE_PATTERN, limit);
}
