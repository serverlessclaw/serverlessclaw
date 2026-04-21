/**
 * Insight Operations Module
 *
 * Handles discovery, storage, and retrieval of agent insights, preferences, and system patterns.
 * Supports hierarchical scoping for multi-tenant isolation.
 */

import { logger } from '../logger';
import { MEMORY_KEYS, TIME } from '../constants';
import type { BaseMemoryProvider } from './base';
import { InsightCategory, MemoryInsight, InsightMetadata, ContextualScope } from '../types/memory';
import { filterPII } from '../utils/pii';

const INSIGHT_TTL_DAYS = 30;

/**
 * Resolves the hierarchical scope identifier for query or storage.
 */
function resolveScopeId(scope?: string | ContextualScope): string | undefined {
  return typeof scope === 'string' ? scope : scope?.workspaceId;
}

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
  params: Record<string, any>
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
    ExpressionAttributeValues: { ':pk': pk },
  });

  const similar = existing.find(
    (item) =>
      item.type === 'MEMORY:INSIGHT' &&
      (item.metadata as any)?.category === categoryToUse &&
      item.content === sanitizedContent
  );

  if (similar) {
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
    | { tags?: string[]; category?: InsightCategory; limit?: number; scope?: ContextualScope },
  queryText?: string,
  category?: InsightCategory,
  limit?: number,
  lastEvaluatedKey?: Record<string, unknown>,
  tags?: string[],
  orgId?: string,
  scope?: string | ContextualScope
): Promise<{ items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }> {
  // 1. Detect if using modern options-based signature
  let resolvedUserId = '';
  let resolvedQuery = '';
  let resolvedTags = tags;
  let resolvedCategory = category;
  let resolvedLimit = limit || 50;
  let resolvedScope = scope;

  if (queryOrUserId && typeof queryOrUserId === 'object' && !Array.isArray(queryOrUserId)) {
    resolvedUserId = (queryOrUserId as any).userId || '';
    resolvedQuery = (queryOrUserId as any).query || '';
    resolvedTags = queryOrUserId.tags || tags;
    resolvedCategory = queryOrUserId.category || category;
    resolvedLimit = queryOrUserId.limit || limit || 50;
    resolvedScope = queryOrUserId.scope || scope;
  } else {
    resolvedUserId = (queryOrUserId as string) || '';
    resolvedQuery = queryText || '';
  }

  const workspaceId = resolveScopeId(resolvedScope);

  // 2. Build DynamoDB Query Parameters
  const params: Record<string, any> = {
    ExpressionAttributeNames: { '#tp': 'type' },
    ExpressionAttributeValues: { ':type': 'MEMORY:INSIGHT' },
  };

  const pk = base.getScopedUserId(resolvedUserId || 'SYSTEM#GLOBAL', resolvedScope);

  if (resolvedUserId) {
    params.IndexName = 'UserInsightIndex';
    params.KeyConditionExpression = '#uid = :userId AND #tp = :type';
    params.ExpressionAttributeNames['#uid'] = 'userId';
    params.ExpressionAttributeValues[':userId'] = pk;
  } else if (resolvedCategory) {
    params.IndexName = 'TypeTimestampIndex';
    params.KeyConditionExpression = '#tp = :type';
    // When no userId, we rely on category filter later or GSI if we had TypeCategoryIndex
  } else {
    // Global fallback
    const pk = base.getScopedUserId('SYSTEM#GLOBAL', resolvedScope);
    params.KeyConditionExpression = 'userId = :pk AND #tp = :type';
    params.ExpressionAttributeValues[':pk'] = pk;
  }

  if (resolvedQuery && resolvedQuery !== '*') {
    params.FilterExpression = 'contains(content, :query)';
    params.ExpressionAttributeValues[':query'] = resolvedQuery;
  }

  if (resolvedLimit) params.Limit = resolvedLimit;
  if (lastEvaluatedKey) params.ExclusiveStartKey = lastEvaluatedKey;

  // 3. Execute Query (Hierarchical fallback if needed)
  let items: MemoryInsight[] = [];
  let nextKey: Record<string, unknown> | undefined;

  // If orgId or userId provided, we might search multiple scopes
  const searchScopes = [pk];
  if (orgId && !resolvedUserId)
    searchScopes.push(base.getScopedUserId(`ORG#${orgId}`, resolvedScope));
  if (!resolvedUserId && pk !== base.getScopedUserId('SYSTEM#GLOBAL'))
    searchScopes.push(base.getScopedUserId('SYSTEM#GLOBAL', resolvedScope));

  if (resolvedUserId && orgId) {
    // Specific hierarchical search: User -> Org -> Global
    const results = await Promise.all([
      queryByTypeAndMap(base, {
        ...params,
        ExpressionAttributeValues: {
          ...params.ExpressionAttributeValues,
          ':userId': base.getScopedUserId(resolvedUserId, resolvedScope),
        },
      }),
      queryByTypeAndMap(base, {
        ...params,
        ExpressionAttributeValues: {
          ...params.ExpressionAttributeValues,
          ':userId': base.getScopedUserId(`ORG#${orgId}`, resolvedScope),
        },
      }),
      queryByTypeAndMap(base, {
        ...params,
        ExpressionAttributeValues: {
          ...params.ExpressionAttributeValues,
          ':userId': base.getScopedUserId('SYSTEM#GLOBAL', resolvedScope),
        },
      }),
    ]);
    items = results.flatMap((r) => r);
  } else {
    items = await queryByTypeAndMap(base, params);
  }

  // 4. Application-level filtering
  let filtered = items;
  if (resolvedTags && resolvedTags.length > 0) {
    const searchTags = normalizeTags(resolvedTags);
    filtered = items.filter((item) => searchTags.some((t) => (item.tags || []).includes(t)));
  }

  if (resolvedCategory) {
    filtered = filtered.filter((item) => item.metadata?.category === resolvedCategory);
  }

  return {
    items: workspaceId ? filtered.filter((f) => f.workspaceId === workspaceId) : filtered,
    lastEvaluatedKey: nextKey,
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
  const attrValues: Record<string, any> = { ':now': now };

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
  limit: number = 20
): Promise<Record<string, unknown>[]> {
  const staleThresholdMs = 14 * 24 * 60 * 60 * 1000; // 14 days
  const now = Date.now();

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
    const typeItems = await base.queryItems({
      IndexName: 'TypeTimestampIndex',
      KeyConditionExpression: '#tp = :type',
      ExpressionAttributeNames: { '#tp': 'type' },
      ExpressionAttributeValues: { ':type': type },
      Limit: limit,
    });
    allItems.push(...(typeItems as Record<string, unknown>[]));
  }

  // 3. Filter: hitCount === 0 and lastAccessed older than stale threshold
  return allItems.filter((item) => {
    const meta = item['metadata'] as Record<string, unknown> | undefined;
    const hitCount = (meta?.['hitCount'] as number) ?? 0;
    const lastAccessed = (meta?.['lastAccessed'] as number) ?? 0;
    return hitCount === 0 && now - lastAccessed > staleThresholdMs;
  });
}
