import { InsightMetadata, InsightCategory, MemoryInsight } from '../types/index';
import type { BaseMemoryProvider } from './base';

/**
 * Shared metadata defaults for all memory items.
 */
export const DEFAULT_INSIGHT_METADATA: InsightMetadata = {
  category: InsightCategory.STRATEGIC_GAP,
  confidence: 5,
  impact: 5,
  complexity: 5,
  risk: 5,
  urgency: 5,
  priority: 5,
  hitCount: 0,
  lastAccessed: Date.now(),
};

/**
 * Normalizes an array of tags by trimming, lowercasing, and removing duplicates.
 *
 * @param tags - Array of raw tag strings.
 * @returns Normalized array of tag strings.
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
 * Creates a complete metadata object with defaults.
 *
 * @param overrides - Partial metadata to override defaults.
 * @param timestamp - The timestamp for the record.
 * @returns A complete InsightMetadata object.
 */
export function createMetadata(
  overrides?: Partial<InsightMetadata>,
  timestamp: number = Date.now()
): InsightMetadata {
  return {
    ...DEFAULT_INSIGHT_METADATA,
    hitCount: overrides?.hitCount ?? 0,
    lastAccessed: overrides?.lastAccessed ?? timestamp,
    ...(overrides ?? {}),
  } as InsightMetadata;
}

/**
 * Universal fetcher for memory items by their type using the GSI.
 *
 * @param base - The base memory provider instance.
 * @param type - The memory type string (e.g., 'GAP', 'LESSON').
 * @param limit - Maximum items to retrieve.
 * @param lastEvaluatedKey - Pagination token.
 * @returns A promise resolving to an array of memory items and a next token.
 */
export async function getMemoryByTypePaginated(
  base: BaseMemoryProvider,
  type: string,
  limit: number = 100,
  lastEvaluatedKey?: Record<string, unknown>
): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
  const result = await base.queryItemsPaginated({
    IndexName: 'TypeTimestampIndex',
    KeyConditionExpression: '#tp = :type',
    ExpressionAttributeNames: {
      '#tp': 'type',
    },
    ExpressionAttributeValues: {
      ':type': type,
    },
    ScanIndexForward: false,
    Limit: limit,
    ExclusiveStartKey: lastEvaluatedKey,
  });

  return {
    items: result.items as Record<string, unknown>[],
    lastEvaluatedKey: result.lastEvaluatedKey,
  };
}

/**
 * Universal fetcher for memory items by their type using the GSI (legacy non-paginated).
 *
 * @param base - The base memory provider instance.
 * @param type - The memory type string (e.g., 'GAP', 'LESSON').
 * @param limit - Maximum items to retrieve.
 * @returns A promise resolving to an array of memory items.
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
 * Retrieves the list of active memory types that have been dynamically registered.
 *
 * @param base - The base memory provider instance.
 * @returns A promise resolving to an array of active memory type strings.
 */
export async function getRegisteredMemoryTypes(base: BaseMemoryProvider): Promise<string[]> {
  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :userId AND #ts = :ts',
    ExpressionAttributeNames: {
      '#ts': 'timestamp',
    },
    ExpressionAttributeValues: {
      ':userId': 'SYSTEM#REGISTRY',
      ':ts': 0,
    },
  });

  const activeTypesSet = items[0]?.activeTypes as Set<string> | string[] | undefined;
  if (!activeTypesSet) return [];

  return Array.isArray(activeTypesSet) ? activeTypesSet : Array.from(activeTypesSet);
}

/**
 * Query the latest items by userId and return their content strings.
 *
 * @param base - The base memory provider instance.
 * @param userId - The userId value to query.
 * @param limit - Maximum number of items to return (default 1).
 * @returns A promise resolving to an array of content strings.
 */
export async function queryLatestContentByUserId(
  base: BaseMemoryProvider,
  userId: string,
  limit: number = 1
): Promise<string[]> {
  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId,
    },
    Limit: limit,
    ScanIndexForward: false,
  });

  return items.map((item) => item.content as string);
}

/**
 * Query items by type using the TypeTimestampIndex GSI and return content strings.
 * Consolidates the common pattern used by getGlobalLessons, getFailedPlans, etc.
 *
 * @param base - The base memory provider instance.
 * @param type - The memory type string (e.g., 'SYSTEM_LESSON', 'FAILED_PLAN').
 * @param limit - Maximum number of items to return.
 * @returns A promise resolving to an array of content strings.
 */
export async function queryByTypeAndGetContent(
  base: BaseMemoryProvider,
  type: string,
  limit: number = 10,
  userId?: string
): Promise<string[]> {
  const params: {
    Limit: number;
    ScanIndexForward: boolean;
    IndexName?: string;
    KeyConditionExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues?: Record<string, unknown>;
  } = {
    Limit: limit,
    ScanIndexForward: false,
  };

  if (userId) {
    params.IndexName = 'UserInsightIndex';
    params.KeyConditionExpression = 'userId = :userId AND #tp = :type';
    params.ExpressionAttributeNames = { '#tp': 'type' };
    params.ExpressionAttributeValues = { ':userId': userId, ':type': type };
  } else {
    params.IndexName = 'TypeTimestampIndex';
    params.KeyConditionExpression = '#tp = :type';
    params.ExpressionAttributeNames = { '#tp': 'type' };
    params.ExpressionAttributeValues = { ':type': type };
  }

  const items = await base.queryItems(params);
  return items.map((item) => item.content as string).filter(Boolean);
}

/**
 * Query items by type using the TypeTimestampIndex GSI and map to MemoryInsight.
 * Consolidates the common pattern used by getAllGaps, getFailedPlans, getGlobalLessons, etc.
 *
 * @param base - The base memory provider instance.
 * @param type - The memory type string (e.g., 'GAP', 'SYSTEM_LESSON', 'FAILED_PLAN').
 * @param defaultCategory - The default InsightCategory for metadata creation.
 * @param limit - Maximum number of items to return.
 * @param filterExpression - Optional additional filter expression.
 * @param expressionAttributeValues - Optional additional expression attribute values for the filter.
 * @returns A promise resolving to an array of MemoryInsight objects.
 */
export async function queryByTypeAndMap(
  base: BaseMemoryProvider,
  type: string,
  defaultCategory: InsightCategory,
  limit: number = 100,
  filterExpression?: string,
  expressionAttributeValues?: Record<string, unknown>,
  userId?: string
): Promise<MemoryInsight[]> {
  const params: {
    Limit: number;
    ScanIndexForward: boolean;
    IndexName?: string;
    KeyConditionExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues: Record<string, unknown>;
    FilterExpression?: string;
  } = {
    Limit: limit,
    ScanIndexForward: false,
    ExpressionAttributeValues: {
      ...expressionAttributeValues,
    },
  };

  if (userId) {
    params.IndexName = 'UserInsightIndex';
    params.KeyConditionExpression = 'userId = :userId AND #tp = :type';
    params.ExpressionAttributeNames = { '#tp': 'type' };
    params.ExpressionAttributeValues[':userId'] = userId;
    params.ExpressionAttributeValues[':type'] = type;
  } else {
    params.IndexName = 'TypeTimestampIndex';
    params.KeyConditionExpression = '#tp = :type';
    params.ExpressionAttributeNames = { '#tp': 'type' };
    params.ExpressionAttributeValues[':type'] = type;
  }

  if (filterExpression) {
    params.FilterExpression = filterExpression;
  }

  const items = await base.queryItems(params);

  return items.map((item) => ({
    id: item.userId as string,
    content: item.content as string,
    timestamp: item.timestamp as number,
    createdAt:
      (item.createdAt as number) ??
      (item.metadata as { createdAt?: number } | undefined)?.createdAt ??
      (item.timestamp as number),
    metadata: createMetadata(
      (item.metadata as Partial<InsightMetadata>) ?? { category: defaultCategory },
      item.timestamp as number
    ),
  }));
}

/**
 * Strips all common prefixes (GAP#, PROC#) from a gap ID to get the raw identifier.
 * Consolidates duplicate logic seen across the codebase.
 *
 * @param gapId - The raw gap ID (e.g., "GAP#123", "PROC#GAP#456").
 * @returns The normalized identifier.
 */
export function normalizeGapId(gapId: string): string {
  if (!gapId) return '';
  return gapId.replace(/^(GAP#)+/, '').replace(/^(PROC#)+/, '');
}

/**
 * Derives the Partition Key (userId) for a gap item in DynamoDB based on its numeric ID.
 *
 * @param gapId - The gap ID.
 * @returns The normalized PK string (e.g., "GAP#123").
 */
export function getGapIdPK(gapId: string): string {
  const normalized = normalizeGapId(gapId);
  const numericMatch = normalized.match(/(\d+)$/);
  const finalId = numericMatch ? numericMatch[1] : normalized;
  return `GAP#${finalId}`;
}

/**
 * Derives the Sort Key (timestamp) for a gap item in DynamoDB based on its numeric ID.
 * Fallback to 0 if the ID is not numeric.
 *
 * @param gapId - The gap ID.
 * @returns The numeric timestamp or 0.
 */
export function getGapTimestamp(gapId: string): number {
  const normalized = normalizeGapId(gapId);
  const numericMatch = normalized.match(/(\d+)$/);
  if (!numericMatch) return 0;
  const parsed = parseInt(numericMatch[1], 10);
  return isNaN(parsed) ? 0 : parsed;
}
