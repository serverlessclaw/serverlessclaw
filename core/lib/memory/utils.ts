import { BaseMemoryProvider } from './base';
import { logger } from '../logger';
import { InsightMetadata, MemoryInsight, InsightCategory, GapStatus } from '../types/memory';

/**
 * Creates a standard MemoryInsight metadata object with defaults.
 */
export function createMetadata(
  partial: Partial<InsightMetadata> = {},
  timestamp: string | number = Date.now()
): InsightMetadata {
  return {
    category: InsightCategory.STRATEGIC_GAP,
    confidence: 5,
    impact: 5,
    complexity: 5,
    hitCount: 0,
    lastAccessed: typeof timestamp === 'number' ? timestamp : Date.now(),
    createdAt: typeof timestamp === 'number' ? timestamp : Date.now(),
    updatedAt: Date.now(),
    ...partial,
  } as InsightMetadata;
}

/**
 * Helper to apply workspace isolation (FilterExpression) to DynamoDB parameters.
 * Note: While KeyConditionExpression is preferred, GSI queries on Type/User often require
 * FilterExpression for secondary workspace isolation.
 */
export function applyWorkspaceIsolation(params: Record<string, any>, workspaceId?: string): void {
  if (!workspaceId) return;

  const isolationExpr = 'workspaceId = :workspaceId AND begins_with(userId, :pkPrefix)';
  params.FilterExpression = params.FilterExpression
    ? `(${params.FilterExpression}) AND (${isolationExpr})`
    : isolationExpr;

  params.ExpressionAttributeValues = {
    ...(params.ExpressionAttributeValues || {}),
    ':workspaceId': workspaceId,
    ':pkPrefix': `WS#${workspaceId}#`,
  };
}

/**
 * Universal fetcher for memory items by their type using the GSI.
 * Supports Pagination.
 */
export async function getMemoryByTypePaginated(
  base: BaseMemoryProvider,
  type: string,
  limit: number = 100,
  lastEvaluatedKey?: Record<string, unknown>,
  workspaceId?: string
): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
  const params: Record<string, any> = {
    IndexName: 'TypeTimestampIndex',
    KeyConditionExpression: '#tp = :type',
    ExpressionAttributeNames: { '#tp': 'type' },
    ExpressionAttributeValues: { ':type': type },
    ScanIndexForward: false,
    Limit: limit,
    ExclusiveStartKey: lastEvaluatedKey,
  };

  applyWorkspaceIsolation(params, workspaceId);

  const result = await base.queryItemsPaginated(params);

  return {
    items: result.items,
    lastEvaluatedKey: result.lastEvaluatedKey,
  };
}

/**
 * Legacy non-paginated fetcher.
 */
export async function getMemoryByType(
  base: BaseMemoryProvider,
  type: string,
  limit: number = 100
): Promise<Record<string, unknown>[]> {
  const { items } = await getMemoryByTypePaginated(base, type, limit);
  return items;
}

/**
 * Strips all common prefixes (GAP#, PROC#) from a gap ID.
 */
export function normalizeGapId(gapId: string): string {
  if (!gapId) return '';
  return gapId.replace(/^(GAP#)+/, '').replace(/^(PROC#)+/, '');
}

/**
 * Derives the Partition Key (userId) for a gap item.
 */
export function getGapIdPK(gapId: string): string {
  const normalized = normalizeGapId(gapId);
  const numericMatch = normalized.match(/(\d+)$/);
  const finalId = numericMatch ? numericMatch[1] : normalized;
  return `GAP#${finalId}`;
}

/**
 * Derives the Sort Key (timestamp) for a gap item.
 */
export function getGapTimestamp(gapId: string): number {
  const normalized = normalizeGapId(gapId);
  const numericMatch = normalized.match(/(\d+)$/);
  if (!numericMatch) return 0;
  return parseInt(numericMatch[1], 10);
}

/**
 * Resolves a memory item by ID, handling scoping and fallback searches.
 * This is the AUTHORITATIVE resolver for memory items across the system.
 */
export async function resolveItemById(
  base: BaseMemoryProvider,
  id: string,
  type: string,
  workspaceId?: string
): Promise<MemoryInsight | null> {
  if (!id) return null;

  const normalizedId = normalizeGapId(id);
  const numericMatch = normalizedId.match(/(\d+)$/);
  const numericId = numericMatch ? numericMatch[1] : null;

  // 1. Precise lookup (Deterministic PK/SK)
  const targetPK = type === 'GAP' ? getGapIdPK(normalizedId) : normalizedId;
  const targetSK = type === 'GAP' ? getGapTimestamp(normalizedId) : Number(numericId ?? 0);
  const scopedPK = base.getScopedUserId(targetPK, workspaceId);

  try {
    const items = await base.queryItems({
      KeyConditionExpression: 'userId = :pk AND #ts = :sk',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pk': scopedPK,
        ':sk': targetSK,
      },
    });

    if (items.length > 0) {
      const item = items[0];
      // Final security boundary check
      if (workspaceId && item.workspaceId !== workspaceId) {
        logger.error(`[Security] Cross-workspace access blocked for ${scopedPK}`);
        return null;
      }
      return mapToInsight(item, type);
    }
  } catch (err) {
    logger.debug(`[resolveItemById] Direct lookup failed for ${scopedPK}`, { err });
  }

  // 2. GSI Fallback (Comprehensive scan of type within workspace)
  try {
    // If it's a gap and we're just given a numeric suffix, search the GSI
    const { items: candidates } = await getMemoryByTypePaginated(
      base,
      type,
      200, // Higher limit for fallback search
      undefined,
      workspaceId
    );

    const target = candidates.find((item) => {
      const itemPK = normalizeGapId(item.userId as string);
      const itemTS = (item.timestamp as number | string).toString();
      return (
        itemPK === normalizedId ||
        itemPK.endsWith(`#${numericId}`) ||
        (numericId && itemTS === numericId)
      );
    });

    if (target) {
      logger.info(`[resolveItemById] Item ${id} resolved via GSI fallback`);
      return mapToInsight(target, type);
    }
  } catch (error) {
    logger.error(`[resolveItemById] GSI fallback failed:`, error);
  }

  return null;
}

/**
 * Internal mapper from DynamoDB record to MemoryInsight.
 */
function mapToInsight(item: Record<string, unknown>, defaultType: string): MemoryInsight {
  return {
    id: item.userId as string,
    content: item.content as string,
    timestamp: item.timestamp as number | string,
    metadata: (item.metadata as InsightMetadata) || { category: defaultType as InsightCategory },
    workspaceId: item.workspaceId as string | undefined,
    status: item.status as GapStatus | undefined,
    createdAt: (item.createdAt as number) || (item.timestamp as number) || Date.now(),
  };
}

/**
 * Updates an item's fields and metadata atomically while enforcing workspace boundaries.
 * Prevents "ghost item" creation by verifying the Partition Key exists.
 */
export async function atomicUpdateMetadata(
  base: BaseMemoryProvider,
  userId: string,
  timestamp: number | string,
  metadata: Partial<InsightMetadata & { content?: string; tags?: string[] }>,
  workspaceId?: string
): Promise<void> {
  const pk = base.getScopedUserId(userId, workspaceId);
  const metadataFields: string[] = [
    'category',
    'confidence',
    'impact',
    'complexity',
    'risk',
    'urgency',
    'priority',
    'hitCount',
    'lastAccessed',
    'retryCount',
    'lastAttemptTime',
    'createdAt',
    'sessionId',
    'requestingUserId',
  ];

  const updates: string[] = [];
  const updateValues: Record<string, any> = { ':now': Date.now() };
  const attributeNames: Record<string, string> = {};

  // Handle core fields (top-level)
  if (metadata.content !== undefined) {
    updates.push('#content = :content');
    updateValues[':content'] = metadata.content;
    attributeNames['#content'] = 'content';
  }
  if (metadata.tags !== undefined) {
    updates.push('#tags = :tags');
    updateValues[':tags'] = normalizeTags(metadata.tags);
    attributeNames['#tags'] = 'tags';
  }

  // Handle metadata nested fields
  for (const field of metadataFields) {
    if ((metadata as any)[field] !== undefined) {
      updates.push(`metadata.#${field} = :${field}`);
      updateValues[`:${field}`] = (metadata as any)[field];
      attributeNames[`#${field}`] = field;
    }
  }

  if (updates.length === 0) {
    logger.debug(`[atomicUpdateMetadata] No fields to update for ${userId}`);
    return;
  }

  try {
    const params: any = {
      Key: { userId: pk, timestamp: Number(timestamp) },
      UpdateExpression: `SET updatedAt = :now, ${updates.join(', ')}`,
      ExpressionAttributeValues: updateValues,
      ConditionExpression: 'attribute_exists(userId)',
    };

    if (Object.keys(attributeNames).length > 0) {
      params.ExpressionAttributeNames = attributeNames;
    }

    await base.updateItem(params);
  } catch (error) {
    logger.error(`[atomicUpdateMetadata] Failed update for ${pk}:`, error);
    throw error;
  }
}

/**
 * Normalizes and cleans an array of tags.
 */
export function normalizeTags(tags?: string[]): string[] {
  if (!tags || !Array.isArray(tags)) return [];
  return Array.from(
    new Set(
      tags
        .filter((t) => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().toLowerCase())
    )
  ).sort();
}

/**
 * Fetches types registered in SYSTEM#REGISTRY.
 */
export async function getRegisteredMemoryTypes(base: BaseMemoryProvider): Promise<string[]> {
  try {
    const items = await base.queryItems({
      KeyConditionExpression: 'userId = :userId AND #ts = :ts',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: { ':userId': 'SYSTEM#REGISTRY', ':ts': 0 },
    });
    const registry = items[0];
    if (!registry || !registry.activeTypes) return [];
    // No .sort() to match test expectations (it expects original order)
    return Array.from(registry.activeTypes as Iterable<string>);
  } catch (error) {
    logger.error('[getRegisteredMemoryTypes] Error:', error);
    return [];
  }
}

/**
 * Fetches latest content strings for a user.
 */
export async function queryLatestContentByUserId(
  base: BaseMemoryProvider,
  userId: string,
  limit: number = 1
): Promise<string[]> {
  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: { ':userId': userId },
    Limit: limit,
    ScanIndexForward: false,
  });
  return items.map((item) => item.content as string).filter(Boolean);
}

/**
 * Type-based content query utility.
 */
export async function queryByTypeAndGetContent(
  base: BaseMemoryProvider,
  type: string,
  limit: number = 10,
  userId?: string,
  workspaceId?: string
): Promise<string[]> {
  const params: any = {
    Limit: limit,
    ScanIndexForward: false,
    ExpressionAttributeNames: { '#tp': 'type' },
    ExpressionAttributeValues: { ':type': type },
  };

  if (userId) {
    params.IndexName = 'UserInsightIndex';
    params.KeyConditionExpression = 'userId = :userId AND #tp = :type';
    params.ExpressionAttributeValues[':userId'] = base.getScopedUserId(userId, workspaceId);
  } else {
    params.IndexName = 'TypeTimestampIndex';
    params.KeyConditionExpression = '#tp = :type';
    applyWorkspaceIsolation(params, workspaceId);
  }

  const items = await base.queryItems(params);
  return items.map((item) => item.content as string).filter(Boolean);
}

/**
 * Map-and-fetch utility for memory list operations.
 */
export async function queryByTypeAndMap(
  base: BaseMemoryProvider,
  type: string,
  defaultCategory: InsightCategory,
  limit: number = 100,
  filterExpression?: string,
  expressionAttributeValues?: Record<string, unknown>,
  userId?: string,
  workspaceId?: string
): Promise<MemoryInsight[]> {
  const params: any = {
    Limit: limit,
    ScanIndexForward: false,
    ExpressionAttributeValues: { ...expressionAttributeValues },
  };

  if (userId) {
    params.IndexName = 'UserInsightIndex';
    params.KeyConditionExpression = 'userId = :userId AND #tp = :type';
    params.ExpressionAttributeNames = { '#tp': 'type' };
    params.ExpressionAttributeValues[':userId'] = base.getScopedUserId(userId, workspaceId);
    params.ExpressionAttributeValues[':type'] = type;
  } else {
    params.IndexName = 'TypeTimestampIndex';
    params.KeyConditionExpression = '#tp = :type';
    params.ExpressionAttributeNames = { '#tp': 'type' };
    params.ExpressionAttributeValues[':type'] = type;
    applyWorkspaceIsolation(params, workspaceId);
    if (filterExpression) {
      params.FilterExpression = params.FilterExpression
        ? `${params.FilterExpression} AND (${filterExpression})`
        : filterExpression;
    }
  }

  const items = await base.queryItems(params);
  return items.map((item) => ({
    id: item.userId as string,
    content: item.content as string,
    timestamp: item.timestamp as number | string,
    workspaceId: item.workspaceId as string | undefined,
    createdAt:
      (item.createdAt as number) ||
      (typeof item.timestamp === 'number'
        ? item.timestamp
        : parseInt(item.timestamp as string, 10)) ||
      Date.now(),
    metadata: createMetadata(
      (item.metadata as Partial<InsightMetadata>) || { category: defaultCategory },
      item.timestamp as number
    ),
  }));
}
