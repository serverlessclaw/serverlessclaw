import { InsightMetadata, InsightCategory } from '../types/index';
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
    ...(overrides || {}),
  } as InsightMetadata;
}

/**
 * Universal fetcher for memory items by their type using the GSI.
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
