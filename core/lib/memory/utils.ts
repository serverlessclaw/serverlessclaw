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
    hitCount: 0,
    lastAccessed: timestamp,
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
    KeyConditionExpression: '#type = :type',
    ExpressionAttributeNames: {
      '#type': 'type',
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
  limit: number = 10
): Promise<string[]> {
  const items = await base.queryItems({
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
  });

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
  expressionAttributeValues?: Record<string, unknown>
): Promise<MemoryInsight[]> {
  const params: Record<string, unknown> = {
    IndexName: 'TypeTimestampIndex',
    KeyConditionExpression: '#type = :type',
    ExpressionAttributeNames: {
      '#type': 'type',
    },
    ExpressionAttributeValues: {
      ':type': type,
      ...expressionAttributeValues,
    },
    ScanIndexForward: false,
    Limit: limit,
  };

  if (filterExpression) {
    params.FilterExpression = filterExpression;
  }

  const items = await base.queryItems(params);

  return items.map((item) => ({
    id: item.userId as string,
    content: item.content as string,
    timestamp: item.timestamp as number,
    metadata: createMetadata(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item.metadata as any) ?? { category: defaultCategory },
      item.timestamp as number
    ),
  }));
}
