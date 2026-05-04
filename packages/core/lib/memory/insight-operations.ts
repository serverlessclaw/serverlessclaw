/**
 * Insight Operations Module
 *
 * Handles discovery, storage, and retrieval of agent insights, preferences, and system patterns.
 * Supports hierarchical scoping for multi-tenant isolation.
 */

import { logger } from '../logger';
import { TIME } from '../constants';
import type { BaseMemoryProvider } from './base';
import { InsightCategory, MemoryInsight, InsightMetadata, ContextualScope } from '../types/memory';
import { filterPII } from '../utils/pii';
import { resolveScopeId, applyWorkspaceIsolation } from './utils';

const INSIGHT_TTL_DAYS = 30;

/**
 * Normalizes tags to ensure consistent searching.
 */
function normalizeTags(tags: string[] = []): string[] {
  return Array.from(new Set(tags.map((t) => t.toLowerCase().trim())));
}

/**
 * Creates standardized metadata for a new insight.
 */
export function createMetadata(
  partial: Partial<InsightMetadata> = {},
  timestamp: string | number
): InsightMetadata {
  return {
    category: (partial.category ?? InsightCategory.STRATEGIC_GAP) as InsightCategory | string,
    confidence: partial.confidence || 5,
    impact: partial.impact || 5,
    complexity: partial.complexity || 5,
    risk: partial.risk || 5,
    urgency: partial.urgency || 5,
    priority: partial.priority || 5,
    sourceTraceId: partial.sourceTraceId || 'manual',
    sourceSessionId: partial.sourceSessionId || 'manual',
    expiresAt:
      partial.expiresAt ||
      Math.floor((Date.now() + (INSIGHT_TTL_DAYS || 30) * TIME.MS_PER_DAY) / 1000),
    hitCount: partial.hitCount || 0,
    lastAccessed:
      partial.lastAccessed || (typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp),
    lastValidatedAt: typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp,
  };
}

/**
 * Helper to query by type and map results to MemoryInsight[].
 */
export async function queryByTypeAndMap(
  base: BaseMemoryProvider,
  params: Record<string, unknown>
): Promise<MemoryInsight[]> {
  const items = await base.queryItems(params);
  return items.map((item) => ({
    id: (item['userId'] as string) || 'unknown',
    userId: item['userId'] as string,
    timestamp: item['timestamp'] as string | number,
    createdAt: item['createdAt'] as number | undefined,
    type: (item['type'] as string) || 'MEMORY:INSIGHT',
    content: (item['content'] as string) || '',
    tags: (item['tags'] as string[]) || [],
    metadata: (item['metadata'] as InsightMetadata) || {
      category: InsightCategory.SYSTEM_KNOWLEDGE,
    },
    workspaceId: item['workspaceId'] as string,
  }));
}

/**
 * Records a localized preference for a specific entity.
 */
export async function setPreference(
  base: BaseMemoryProvider,
  entityId: string, // e.g. USER#123
  content: string,
  metadata?: Partial<InsightMetadata> & { tags?: string[] },
  scope?: string | ContextualScope
): Promise<string> {
  const timestamp = String(Date.now());
  const pk = base.getScopedUserId(entityId, scope);
  const workspaceId = resolveScopeId(scope);

  const metadataObj = createMetadata(
    { ...metadata, category: InsightCategory.USER_PREFERENCE },
    timestamp
  );
  await base.putItem({
    userId: pk,
    timestamp,
    type: 'MEMORY:PREFERENCE',
    tags: normalizeTags(['preference', ...(metadata?.tags ?? [])]),
    content,
    expiresAt: metadataObj.expiresAt,
    createdAt: parseInt(timestamp, 10),
    metadata: metadataObj,
    workspaceId,
  });

  return timestamp;
}

/**
 * Adds a new granular memory item into the user or global scope.
 */
export async function addMemory(
  base: BaseMemoryProvider,
  scopeId: string,
  category: InsightCategory | string,
  content: string,
  metadata?: Partial<InsightMetadata> & { orgId?: string; tags?: string[] },
  scope?: string | ContextualScope
): Promise<number | string> {
  const timestamp = String(Date.now());
  const pk = base.getScopedUserId(scopeId, scope);
  const workspaceId = resolveScopeId(scope);

  const categoryToUse =
    typeof category === 'string' ? category : (category ?? InsightCategory.SYSTEM_KNOWLEDGE);
  const sanitizedContent = filterPII(content || '');

  // 1. Check for similar memory to deduplicate (Atomic Similarity Boundary)
  const existing = await base.queryItems({
    KeyConditionExpression: 'userId = :pk',
    FilterExpression: '#tp = :type AND metadata.category = :cat AND content = :content',
    ExpressionAttributeNames: { '#tp': 'type' },
    ExpressionAttributeValues: {
      ':pk': pk,
      ':type': 'MEMORY:INSIGHT',
      ':cat': categoryToUse,
      ':content': sanitizedContent,
    },
    Limit: 1, // We only need to know if at least one exists
  });

  if (existing.length > 0) {
    const similar = existing[0];
    logger.info(`[Memory] Deduplicated similar content for ${pk}`);
    await recordMemoryHit(base, pk, String(similar.timestamp), scope);
    return similar.timestamp as string;
  }

  // 2. Add new memory if no match found
  const metadataObj = createMetadata(
    {
      ...metadata,
      category: categoryToUse,
    },
    timestamp
  );

  await base.putItem({
    userId: pk,
    timestamp,
    type: 'MEMORY:INSIGHT',
    tags: normalizeTags(metadata?.tags),
    content: sanitizedContent,
    expiresAt: metadataObj.expiresAt,
    createdAt: parseInt(timestamp, 10),
    metadata: metadataObj,
    workspaceId,
  });

  // 3. Register memory type in registry (Principle 13)
  try {
    await base.updateItem({
      Key: { userId: 'SYSTEM#REGISTRY', timestamp: 0 },
      UpdateExpression: 'ADD activeTypes :type',
      ExpressionAttributeValues: { ':type': new Set([categoryToUse]) },
    });
  } catch (e) {
    logger.warn(`Failed to update memory registry for ${pk}: ${e}`);
  }

  return timestamp;
}

/**
 * Omni-Signature search implementation.
 * Supports legacy positional and modern options-based queries.
 */
export async function searchInsights(
  base: BaseMemoryProvider,
  queryOrUserId?:
    | string
    | {
        query?: string;
        tags?: string[];
        category?: InsightCategory;
        limit?: number;
        scope?: ContextualScope;
        userId?: string;
      },
  queryText?: string,
  category?: InsightCategory,
  limit?: number,
  lastEvaluatedKey?: Record<string, unknown>,
  tags?: string[],
  orgId?: string,
  scope?: string | ContextualScope
): Promise<{ items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }> {
  // 1. Detect if using modern options-based signature
  let resolvedUserId: string;
  let resolvedQuery: string;
  let resolvedTags = tags;
  let resolvedCategory = category;
  let resolvedLimit = limit || 50;
  let resolvedScope = scope;

  if (queryOrUserId && typeof queryOrUserId === 'object' && !Array.isArray(queryOrUserId)) {
    resolvedUserId = ((queryOrUserId as Record<string, unknown>).userId as string) || '';
    resolvedQuery = ((queryOrUserId as Record<string, unknown>).query as string) || '';
    resolvedTags = queryOrUserId.tags || tags;
    resolvedCategory = queryOrUserId.category || category;
    resolvedLimit = queryOrUserId.limit || limit || 50;
    resolvedScope = queryOrUserId.scope || scope;
  } else {
    resolvedUserId = (queryOrUserId as string) || '';
    resolvedQuery = queryText || '';
  }

  // 2. Build DynamoDB Query Parameters
  const params: Record<string, unknown> = {
    ExpressionAttributeNames: { '#tp': 'type' },
    ExpressionAttributeValues: { ':type': 'MEMORY:INSIGHT' },
  };

  const pk = base.getScopedUserId(resolvedUserId || 'SYSTEM#GLOBAL', resolvedScope);

  if (resolvedUserId) {
    params.IndexName = 'UserInsightIndex';
    params.KeyConditionExpression = '#uid = :userId AND #tp = :type';
    (params.ExpressionAttributeNames as Record<string, string>)['#uid'] = 'userId';
    (params.ExpressionAttributeValues as Record<string, unknown>)[':userId'] = pk;
  } else if (resolvedCategory) {
    params.IndexName = 'TypeTimestampIndex';
    params.KeyConditionExpression = '#tp = :type';
    // When no userId, we rely on category filter later or GSI if we had TypeCategoryIndex
    applyWorkspaceIsolation(params, resolvedScope);
  } else {
    // Global fallback
    params.IndexName = 'UserInsightIndex';
    params.KeyConditionExpression = 'userId = :pk AND #tp = :type';
    (params.ExpressionAttributeValues as Record<string, unknown>)[':pk'] = pk;
    // For global fallback, if it's scoped it should use PK, but if we're not sure, adding FilterExpression doesn't hurt
    if (resolvedScope) {
      applyWorkspaceIsolation(params, resolvedScope);
    }
  }

  if (resolvedQuery && resolvedQuery !== '*') {
    const containsExpr = 'contains(content, :query)';
    params.FilterExpression = params.FilterExpression
      ? `(${params.FilterExpression as string}) AND (${containsExpr})`
      : containsExpr;
    (params.ExpressionAttributeValues as Record<string, unknown>)[':query'] = resolvedQuery;
  }

  if (resolvedLimit) params.Limit = resolvedLimit;
  if (lastEvaluatedKey) params.ExclusiveStartKey = lastEvaluatedKey;

  // 4. Execute Query (Hierarchical fallback if needed)
  let items: MemoryInsight[];

  if (resolvedUserId && orgId) {
    // Specific hierarchical search: User -> Org -> Global
    const queries = [
      queryByTypeAndMap(base, {
        ...params,
        ExpressionAttributeValues: {
          ...(params.ExpressionAttributeValues as Record<string, unknown>),
          ':userId': base.getScopedUserId(resolvedUserId, resolvedScope),
        },
      }),
      queryByTypeAndMap(base, {
        ...params,
        ExpressionAttributeValues: {
          ...(params.ExpressionAttributeValues as Record<string, unknown>),
          ':userId': base.getScopedUserId(`ORG#${orgId}`),
        },
      }),
      queryByTypeAndMap(base, {
        ...params,
        ExpressionAttributeValues: {
          ...(params.ExpressionAttributeValues as Record<string, unknown>),
          ':userId': base.getScopedUserId('SYSTEM#GLOBAL'),
        },
      }),
    ];

    // Include workspace-scoped org/global if searching within a workspace
    const workspaceId = resolveScopeId(resolvedScope);
    if (workspaceId) {
      queries.push(
        queryByTypeAndMap(base, {
          ...params,
          ExpressionAttributeValues: {
            ...(params.ExpressionAttributeValues as Record<string, unknown>),
            ':userId': base.getScopedUserId(`ORG#${orgId}`, resolvedScope),
          },
        })
      );
      queries.push(
        queryByTypeAndMap(base, {
          ...params,
          ExpressionAttributeValues: {
            ...(params.ExpressionAttributeValues as Record<string, unknown>),
            ':userId': base.getScopedUserId('SYSTEM#GLOBAL', resolvedScope),
          },
        })
      );
    }

    const results = await Promise.all(queries);
    items = results.flatMap((r) => r);
  } else {
    // For general search, ensure workspace isolation is applied to params
    applyWorkspaceIsolation(params, resolvedScope);
    items = await queryByTypeAndMap(base, params);
  }

  // 5. Application-level filtering for tags and categories (if not in query)
  let filtered = items;
  if (resolvedTags && resolvedTags.length > 0) {
    const searchTags = normalizeTags(resolvedTags);
    filtered = items.filter((item) => searchTags.some((t) => (item.tags || []).includes(t)));
  }

  if (resolvedCategory) {
    filtered = filtered.filter((item) => item.metadata?.category === resolvedCategory);
  }

  return {
    items: filtered,
  };
}

/**
 * Adds a tactical lesson
 */
export async function addLesson(
  base: BaseMemoryProvider,
  userId: string,
  content: string,
  metadata?: Partial<InsightMetadata>,
  scope?: string | ContextualScope
): Promise<void> {
  const timestamp = String(Date.now());
  const pk = base.getScopedUserId(`USER#${userId}`, scope);
  const workspaceId = resolveScopeId(scope);

  const metadataObj = createMetadata(
    { ...metadata, category: InsightCategory.TACTICAL_LESSON },
    timestamp
  );

  await base.putItem({
    userId: pk,
    timestamp,
    type: 'MEMORY:INSIGHT',
    tags: normalizeTags(['lesson']),
    content,
    expiresAt: metadataObj.expiresAt,
    createdAt: parseInt(timestamp, 10),
    metadata: metadataObj,
    workspaceId,
  });
}

/**
 * Adds a system-wide lesson that benefits ALL users and sessions.
 */
export async function addGlobalLesson(
  base: BaseMemoryProvider,
  lesson: string,
  metadata?: Partial<InsightMetadata>
): Promise<number | string> {
  const timestamp = String(Date.now());
  const pk = base.getScopedUserId('SYSTEM#GLOBAL');

  const metadataObj = createMetadata(
    { ...metadata, category: InsightCategory.SYSTEM_KNOWLEDGE },
    timestamp
  );

  await base.putItem({
    userId: pk,
    timestamp,
    type: 'MEMORY:INSIGHT',
    tags: normalizeTags(['global', 'lesson']),
    content: lesson,
    expiresAt: metadataObj.expiresAt,
    createdAt: parseInt(timestamp, 10),
    metadata: metadataObj,
  });

  return timestamp;
}

/**
 * Retrieves recent tactical lessons
 */
export async function getLessons(
  base: BaseMemoryProvider,
  userId: string,
  scope?: string | ContextualScope
): Promise<string[]> {
  const pk = base.getScopedUserId(`USER#${userId}`, scope);

  const items = await queryByTypeAndMap(base, {
    IndexName: 'UserInsightIndex',
    KeyConditionExpression: 'userId = :pk AND #type = :type',
    ExpressionAttributeNames: { '#type': 'type' },
    ExpressionAttributeValues: {
      ':pk': pk,
      ':type': 'MEMORY:INSIGHT',
    },
  });

  return items
    .filter((i) => i.metadata?.category === InsightCategory.TACTICAL_LESSON)
    .map((i) => i.content);
}

/**
 * Retrieves all lessons from the system.
 */
export async function getGlobalLessons(
  base: BaseMemoryProvider,
  limit: number = 20,
  scope?: string | ContextualScope
): Promise<string[]> {
  const pk = base.getScopedUserId('SYSTEM#GLOBAL', scope);

  const items = await queryByTypeAndMap(base, {
    IndexName: 'UserInsightIndex',
    KeyConditionExpression: 'userId = :pk AND #type = :type',
    ExpressionAttributeNames: { '#type': 'type' },
    ExpressionAttributeValues: {
      ':pk': pk,
      ':type': 'MEMORY:INSIGHT',
    },
    Limit: limit,
  });

  return items
    .filter((i) => i.metadata?.category === InsightCategory.SYSTEM_KNOWLEDGE)
    .slice(0, limit)
    .map((i) => i.content);
}

/**
 * Retrieves failure patterns to identify recurring systemic issues.
 */
export async function getFailurePatterns(
  base: BaseMemoryProvider,
  limit: number = 10,
  scope?: string | ContextualScope
): Promise<MemoryInsight[]> {
  const { items } = await searchInsights(
    base,
    { category: InsightCategory.FAILURE_PATTERN, limit },
    undefined,
    undefined,
    limit,
    undefined,
    undefined,
    undefined,
    scope
  );
  return items;
}

/**
 * Records a recurring failure pattern for metabolic analysis.
 */
export async function recordFailurePattern(
  base: BaseMemoryProvider,
  planHash: string,
  planContent: string,
  gapIds: string[],
  failureReason: string,
  metadata?: Partial<InsightMetadata> & { orgId?: string; tags?: string[] },
  scope?: string | ContextualScope
): Promise<string | number> {
  const timestamp = String(Date.now());
  const content = JSON.stringify({ planHash, planContent, gapIds, failureReason });
  const pk = base.getScopedUserId('SYSTEM#GLOBAL', scope);
  const workspaceId = resolveScopeId(scope);

  await base.putItem({
    userId: pk,
    timestamp,
    type: 'MEMORY:FAILURE_PATTERN',
    tags: normalizeTags(['failed_plan', ...(metadata?.tags ?? [])]),
    content,
    createdAt: parseInt(timestamp, 10),
    metadata: createMetadata(metadata, timestamp),
    workspaceId,
  });
  return timestamp;
}

/**
 * Standardized update for insight metadata fields.
 * Uses atomic update expressions to prevent overwriting other fields.
 */
export async function updateInsightMetadata(
  base: BaseMemoryProvider,
  userId: string,
  timestamp: number | string,
  metadata: Partial<InsightMetadata>,
  scope?: string | ContextualScope
): Promise<void> {
  const pk = base.getScopedUserId(userId, scope);
  const { atomicUpdateMetadata } = await import('./utils');

  return atomicUpdateMetadata(base, pk, timestamp, metadata, scope);
}

/**
 * Refines an existing memory item atomically using UpdateCommand.
 * Scoped to Principle 13 (Atomic State Integrity).
 */
export async function refineMemory(
  base: BaseMemoryProvider,
  userId: string,
  timestamp: number | string,
  content?: string,
  metadata?: Partial<InsightMetadata> & { tags?: string[] },
  scope?: string | ContextualScope
): Promise<void> {
  const pk = base.getScopedUserId(userId, scope);
  const now = Date.now();

  const updateExpr: string[] = ['SET updatedAt = :now'];
  const attrNames: Record<string, string> = { '#content': 'content' };
  const attrValues: Record<string, unknown> = { ':now': now };

  if (metadata) {
    Object.entries(metadata).forEach(([key, val]) => {
      if (key === 'tags' && Array.isArray(val)) {
        updateExpr.push('#tags = :tags');
        attrNames['#tags'] = 'tags';
        attrValues[':tags'] = normalizeTags(val);
      } else if (key !== 'tags') {
        const metaKey = `#${key}`;
        const valKey = `:${key}`;
        updateExpr.push(`metadata.${metaKey} = ${valKey}`);
        attrNames[metaKey] = key;
        attrValues[valKey] = val;
      }
    });
  }

  if (content !== undefined) {
    updateExpr.push('#content = :content');
    attrNames['#content'] = 'content';
    attrValues[':content'] = filterPII(content);
  }

  await base.updateItem({
    Key: { userId: pk, timestamp },
    UpdateExpression: updateExpr.join(', '),
    ExpressionAttributeNames: attrNames,
    ExpressionAttributeValues: attrValues,
    ConditionExpression: 'attribute_exists(userId)',
  });
}
/**
 * Atomically increments hit count and updates lastAccessed timestamp.
 */
export async function recordMemoryHit(
  base: BaseMemoryProvider,
  userId: string,
  timestamp: string | number,
  scope?: string | ContextualScope
): Promise<void> {
  const pk = base.getScopedUserId(userId, scope);
  const now = Date.now();

  try {
    await base.updateItem({
      Key: { userId: pk, timestamp },
      UpdateExpression:
        'SET metadata.hitCount = if_not_exists(metadata.hitCount, :zero) + :inc, metadata.lastAccessed = :now',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':inc': 1,
        ':now': now,
      },
      ConditionExpression: 'attribute_exists(userId)',
    });
  } catch (error) {
    logger.warn(`Failed to record memory hit for ${pk}: ${error}`);
  }
}

/**
 * Retrieves memory items with low utilization for metabolic analysis.
 * Queries the SYSTEM#REGISTRY for all registered memory types, then fetches
 * items by type and filters by stale access patterns.
 */
export async function getLowUtilizationMemory(
  base: BaseMemoryProvider,
  limit: number = 20,
  scope?: string | ContextualScope
): Promise<Record<string, unknown>[]> {
  const staleThresholdMs = 14 * 24 * 60 * 60 * 1000; // 14 days
  const now = Date.now();
  const workspaceId = resolveScopeId(scope);

  // 1. Fetch registered memory types from the registry
  const registryItems = await base.queryItems({
    KeyConditionExpression: 'userId = :pk AND #ts = :zero',
    ExpressionAttributeNames: { '#ts': 'timestamp' },
    ExpressionAttributeValues: { ':pk': 'SYSTEM#REGISTRY', ':zero': 0 },
  });
  const types: string[] = (registryItems[0]?.activeTypes as string[]) ?? [];

  if (types.length === 0) return [];

  // 2. For each type, query items and collect stale ones
  const allItems: Record<string, unknown>[] = [];
  for (const type of types) {
    const params: any = {
      IndexName: 'TypeTimestampIndex',
      KeyConditionExpression: '#tp = :type',
      ExpressionAttributeNames: { '#tp': 'type' },
      ExpressionAttributeValues: { ':type': type },
      Limit: limit,
    };
    applyWorkspaceIsolation(params, scope);

    const typeItems = await base.queryItems(params);
    allItems.push(...(typeItems as Record<string, unknown>[]));
  }

  // 3. Filter: hitCount === 0 and lastAccessed older than stale threshold
  return allItems.filter((item) => {
    const meta = item['metadata'] as Record<string, unknown> | undefined;
    const hitCount = (meta?.['hitCount'] as number) ?? 0;
    const lastAccessed = (meta?.['lastAccessed'] as number) ?? 0;
    const itemWorkspaceId = item['workspaceId'] as string | undefined;

    // Double-check isolation even after server-side filter
    if (workspaceId && itemWorkspaceId !== workspaceId) return false;

    return hitCount === 0 && now - lastAccessed > staleThresholdMs;
  });
}
