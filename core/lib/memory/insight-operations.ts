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
  normalizeTags,
  queryLatestContentByUserId,
  queryByTypeAndGetContent,
  queryByTypeAndMap,
  getMemoryByType,
  getRegisteredMemoryTypes,
} from './utils';

/**
 * Finds a similar memory item to prevent duplication.
 * Uses a simple Jaccard similarity based on keywords.
 */
async function findSimilarMemory(
  base: BaseMemoryProvider,
  scopeId: string,
  category: InsightCategory | string,
  content: string
): Promise<MemoryInsight | null> {
  try {
    const fullType = `MEMORY:${category.toString().toUpperCase()}`;
    const items = await queryByTypeAndMap(
      base,
      fullType,
      category as InsightCategory,
      50,
      undefined,
      undefined,
      scopeId
    );

    if (items.length === 0) return null;

    const newKeywords = content
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);
    for (const item of items) {
      const oldKeywords = item.content
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3);
      const intersection = newKeywords.filter((w) => oldKeywords.includes(w));
      const similarity = intersection.length / Math.max(newKeywords.length, oldKeywords.length);
      if (similarity > 0.6) return item;
    }
  } catch (error) {
    console.warn('Similarity check failed:', error);
  }
  return null;
}

/**
 * Shared implementation for adding granular records (Insights/Memories).
 */
async function addRecord(
  base: BaseMemoryProvider,
  baseCategory: 'MEMORY',
  scopeId: string,
  category: InsightCategory | string,
  content: string,
  metadata?: Partial<InsightMetadata> & { orgId?: string; tags?: string[] }
): Promise<number> {
  const { expiresAt } = await RetentionManager.getExpiresAt(baseCategory, scopeId);
  const scrubbedContent = filterPII(content);
  const fullType = `MEMORY:${category.toString().toUpperCase()}`;

  // 1. Semantic Deduplication / Upsert
  const existing = await findSimilarMemory(base, scopeId, category, scrubbedContent);
  if (existing) {
    await recordMemoryHit(base, existing.userId || scopeId, existing.timestamp);
    if (metadata?.tags || metadata?.priority) {
      await refineMemory(base, existing.userId || scopeId, existing.timestamp, undefined, {
        priority: metadata?.priority,
        // Tags are merged at the root level in refineMemory if we update it, but for now we update metadata
      });
    }
    return existing.timestamp;
  }

  const timestamp = Date.now();

  // 2. Register usage type
  try {
    await base.updateItem({
      Key: { userId: 'SYSTEM#REGISTRY', timestamp: 0 },
      UpdateExpression: 'ADD activeTypes :type',
      ExpressionAttributeValues: { ':type': new Set([fullType]) },
    });
  } catch (error) {
    // Registry update failure is non-fatal for memory persistence
    console.warn('Memory registry update failed:', error);
  }

  // 3. Insert flattened record
  await base.putItem({
    userId: scopeId,
    timestamp,
    createdAt: timestamp,
    type: fullType,
    orgId: metadata?.orgId,
    tags: normalizeTags(metadata?.tags),
    expiresAt,
    content: scrubbedContent,
    metadata: createMetadata(metadata, timestamp),
  });
  return timestamp;
}

/**
 * Atomically increments the hit count and updates the lastAccessed timestamp.
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
      ExpressionAttributeValues: { ':zero': 0, ':inc': 1, ':now': Date.now() },
      ConditionExpression: 'attribute_exists(userId)',
    });
  } catch (e) {
    console.warn(`Failed to record memory hit for ${userId}@${timestamp}`, e);
  }
}

/**
 * Adds a tactical lesson.
 */
export async function addLesson(
  base: BaseMemoryProvider,
  userId: string,
  lesson: string,
  metadata?: Partial<InsightMetadata> & { tags?: string[] }
): Promise<void> {
  const { expiresAt } = await RetentionManager.getExpiresAt('MEMORY', userId);
  const timestamp = Date.now();
  await base.putItem({
    userId,
    timestamp,
    type: 'MEMORY:TACTICAL_LESSON',
    tags: normalizeTags(metadata?.tags),
    content: filterPII(lesson),
    createdAt: timestamp,
    expiresAt,
    metadata: createMetadata(metadata, timestamp),
  });
}

/**
 * Retrieves recent tactical lessons.
 */
export async function getLessons(base: BaseMemoryProvider, userId: string): Promise<string[]> {
  return queryLatestContentByUserId(base, userId, 10);
}

/**
 * Adds a system-wide lesson.
 */
export async function addGlobalLesson(
  base: BaseMemoryProvider,
  lesson: string,
  metadata?: Partial<InsightMetadata> & { tags?: string[] }
): Promise<number> {
  const timestamp = Date.now();
  await base.putItem({
    userId: 'SYSTEM#GLOBAL',
    timestamp,
    type: 'MEMORY:SYSTEM_LESSON',
    tags: normalizeTags(metadata?.tags),
    content: filterPII(lesson),
    createdAt: timestamp,
    metadata: createMetadata(metadata, timestamp),
  });
  return timestamp;
}

/**
 * Retrieves system-wide lessons.
 */
export async function getGlobalLessons(
  base: BaseMemoryProvider,
  limit: number = 10
): Promise<string[]> {
  return queryByTypeAndGetContent(base, 'MEMORY:SYSTEM_LESSON', limit);
}

/**
 * Adds a new granular memory item.
 */
export async function addMemory(
  base: BaseMemoryProvider,
  scopeId: string,
  category: InsightCategory | string,
  content: string,
  metadata?: Partial<InsightMetadata> & { orgId?: string; tags?: string[] }
): Promise<number> {
  return addRecord(base, 'MEMORY', scopeId, category, content, metadata);
}

/**
 * Searches for insights across personal, organizational, and global scopes.
 *
 * @param base - The base memory provider.
 * @param userId - Optional user ID to scope the search.
 * @param query - Search query string.
 * @param category - Optional category filter.
 * @param limit - Maximum number of results to return.
 * @param lastEvaluatedKey - Optional pagination key from a previous search.
 * @param tags - Optional tags to filter by.
 * @param orgId - Optional organization ID to include org-scoped insights.
 */
export async function searchInsights(
  base: BaseMemoryProvider,
  userId?: string,
  query: string = '',
  category?: InsightCategory,
  limit: number = 50,
  lastEvaluatedKey?: Record<string, unknown>,
  tags?: string[],
  orgId?: string
): Promise<{ items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }> {
  const items: MemoryInsight[] = [];
  const normalizedTags = normalizeTags(tags ?? []);
  const scopes: string[] = [];

  if (userId) scopes.push(userId);
  if (orgId) scopes.push(`ORG#${orgId}`);
  if (userId && !userId.startsWith('SYSTEM#')) scopes.push('SYSTEM#GLOBAL');

  const fullType = `MEMORY:${category?.toUpperCase()}`;

  if (!category) {
    if (scopes.length === 0) return { items: [] };
    for (const scope of scopes) {
      const { items: scopeItems } = await base.queryItemsPaginated({
        KeyConditionExpression: 'userId = :scope',
        ExpressionAttributeValues: { ':scope': scope },
        Limit: limit,
        ScanIndexForward: false,
      });
      items.push(...mapToInsights(scopeItems as Record<string, unknown>[]));
    }
    return { items: items.slice(0, limit) };
  }

  // If no userId but category is provided, use TypeTimestampIndex to search all items
  if (scopes.length === 0) {
    const params: {
      IndexName: string;
      KeyConditionExpression: string;
      ExpressionAttributeNames: Record<string, string>;
      ExpressionAttributeValues: Record<string, unknown>;
      Limit: number;
      ScanIndexForward: boolean;
      FilterExpression?: string;
    } = {
      IndexName: 'TypeTimestampIndex',
      KeyConditionExpression: '#tp = :type',
      ExpressionAttributeNames: { '#tp': 'type' },
      ExpressionAttributeValues: { ':type': fullType },
      Limit: limit,
      ScanIndexForward: false,
    };

    if (query && query !== '*' && query !== '') {
      params.FilterExpression = 'contains(content, :query)';
      params.ExpressionAttributeValues[':query'] = query;
    }

    const { items: allItems } = await base.queryItemsPaginated(params);
    let mapped = mapToInsights(allItems as Record<string, unknown>[]);

    if (normalizedTags.length > 0) {
      mapped = mapped.filter((item) => normalizedTags.some((tag) => item.tags?.includes(tag)));
    }

    return { items: mapped.slice(0, limit) };
  }

  for (const scope of scopes) {
    const params: {
      IndexName: string;
      KeyConditionExpression: string;
      ExpressionAttributeNames: Record<string, string>;
      ExpressionAttributeValues: Record<string, unknown>;
      Limit: number;
      ScanIndexForward: boolean;
      FilterExpression?: string;
    } = {
      IndexName: 'UserInsightIndex',
      KeyConditionExpression: '#uid = :userId AND #tp = :type',
      ExpressionAttributeNames: { '#uid': 'userId', '#tp': 'type' },
      ExpressionAttributeValues: { ':userId': scope, ':type': fullType },
      Limit: limit,
      ScanIndexForward: false,
    };

    if (query && query !== '*' && query !== '') {
      params.FilterExpression = 'contains(content, :query)';
      params.ExpressionAttributeValues[':query'] = query;
    }

    const { items: scopeItems } = await base.queryItemsPaginated(params);
    let mapped = mapToInsights(scopeItems as Record<string, unknown>[]);

    if (normalizedTags.length > 0) {
      mapped = mapped.filter((item) => normalizedTags.some((tag) => item.tags?.includes(tag)));
    }

    items.push(...mapped);
    if (items.length >= limit) break;
  }

  return { items: items.slice(0, limit) };
}

/**
 * Helper to map DB items to MemoryInsight objects with backward compatibility.
 */
function mapToInsights(items: Record<string, unknown>[]): MemoryInsight[] {
  return items.map((item) => {
    const timestamp = (item.timestamp as number) || Date.now();
    const metadataRaw = (item.metadata as Partial<InsightMetadata>) || {};

    const tags =
      (item.tags as string[]) ||
      (metadataRaw as Record<string, unknown>).tags ||
      (metadataRaw as Record<string, unknown>).contextualKeywords;
    const orgId = ((item.orgId as string) || (metadataRaw as Record<string, unknown>).orgId) as
      | string
      | undefined;
    const userId = ((item.userId as string) || (metadataRaw as Record<string, unknown>).userId) as
      | string
      | undefined;
    const createdAt = ((item.createdAt as number) ||
      (metadataRaw as Record<string, unknown>).createdAt ||
      timestamp) as number;

    return {
      id: (item.id || item.userId) as string,
      content: item.content as string,
      timestamp,
      orgId,
      userId,
      tags: normalizeTags(tags),
      createdAt,
      metadata: createMetadata(metadataRaw, timestamp),
    };
  });
}

/**
 * Updates metadata for a specific insight.
 */
export async function updateInsightMetadata(
  base: BaseMemoryProvider,
  userId: string,
  timestamp: number,
  metadata: Partial<InsightMetadata>
): Promise<void> {
  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :userId AND #ts = :timestamp',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: { ':userId': userId, ':timestamp': timestamp },
  });

  if (items[0]) {
    await base.putItem({
      ...items[0],
      metadata: { ...(items[0].metadata ?? {}), ...metadata },
    });
  }
}

/**
 * Retrieves memory items with low utilization.
 */
export async function getLowUtilizationMemory(
  base: BaseMemoryProvider,
  limit: number = 20
): Promise<Record<string, unknown>[]> {
  const registeredTypes = await getRegisteredMemoryTypes(base);
  const now = Date.now();
  const STALE_THRESHOLD = 14 * 24 * 60 * 60 * 1000;

  const filteredTypes = registeredTypes.filter((type) => type.startsWith('MEMORY:'));
  const results = await Promise.all(filteredTypes.map((type) => getMemoryByType(base, type, 50)));

  const staleItems = results.flat().filter((item) => {
    const meta = item.metadata as InsightMetadata;
    return (
      meta &&
      (meta.hitCount || 0) === 0 &&
      now - (meta.lastAccessed || (item.timestamp as number) || now) > STALE_THRESHOLD
    );
  });

  return staleItems
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
    .slice(0, limit);
}

/**
 * Records a failure pattern.
 */
export async function recordFailurePattern(
  base: BaseMemoryProvider,
  scopeId: string,
  content: string,
  metadata?: Partial<InsightMetadata> & { orgId?: string; tags?: string[] }
): Promise<number> {
  return addMemory(base, scopeId, InsightCategory.FAILURE_PATTERN, content, metadata);
}

/**
 * Retrieves failure patterns.
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

/**
 * Records a failed strategic plan.
 *
 * @param base - The base memory provider.
 * @param planHash - Unique hash identifying the plan.
 * @param planContent - The content of the failed plan.
 * @param gapIds - IDs of gaps associated with the plan.
 * @param failureReason - Description of why the plan failed.
 * @param metadata - Optional metadata including org scope and tags.
 */
export async function recordFailedPlan(
  base: BaseMemoryProvider,
  planHash: string,
  planContent: string,
  gapIds: string[],
  failureReason: string,
  metadata?: Partial<InsightMetadata> & { orgId?: string; tags?: string[] }
): Promise<number> {
  const timestamp = Date.now();
  const content = JSON.stringify({ planHash, planContent, gapIds, failureReason });

  await base.putItem({
    userId: 'SYSTEM#GLOBAL',
    timestamp,
    type: 'MEMORY:FAILURE_PATTERN',
    tags: normalizeTags(['failed_plan', ...(metadata?.tags ?? [])]),
    content,
    createdAt: timestamp,
    metadata: createMetadata(metadata, timestamp),
  });
  return timestamp;
}

/**
 * Retrieves previously failed plans.
 */
export async function getFailedPlans(
  base: BaseMemoryProvider,
  limit: number = 10
): Promise<MemoryInsight[]> {
  return queryByTypeAndMap(
    base,
    'MEMORY:FAILURE_PATTERN',
    InsightCategory.FAILURE_PATTERN,
    limit,
    'contains(tags, :failed)',
    { ':failed': 'failed_plan' }
  );
}

/**
 * Refines or updates a memory item.
 */
export async function refineMemory(
  base: BaseMemoryProvider,
  userId: string,
  timestamp: number,
  content?: string,
  metadata?: Partial<InsightMetadata> & { tags?: string[] }
): Promise<void> {
  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :userId AND #ts = :timestamp',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: { ':userId': userId, ':timestamp': timestamp },
  });

  const item = items[0];
  if (!item) throw new Error(`Memory item not found: ${userId}@${timestamp}`);

  await base.putItem({
    ...item,
    content: content ? filterPII(content) : item.content,
    tags: metadata?.tags
      ? normalizeTags([...((item.tags as string[]) || []), ...metadata.tags])
      : item.tags,
    metadata: {
      ...(item.metadata ?? {}),
      ...(metadata ?? {}),
      lastAccessed: Date.now(),
    },
  });
}
