/**
 * Insight Operations Module
 *
 * Contains insight and lesson management methods for the DynamoMemory class.
 * These functions operate on a BaseMemoryProvider instance.
 */

import { MemoryInsight, InsightMetadata, InsightCategory } from '../types/index';
import { RetentionManager } from './tiering';
import type { BaseMemoryProvider } from './base';

/**
 * Shared implementation for adding granular records (Insights/Memories)
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
    content,
    metadata: {
      category,
      confidence: 10,
      impact: 5,
      complexity: 5,
      risk: 5,
      urgency: 5,
      priority: 5,
      hitCount: 0,
      lastAccessed: timestamp,
      ...(metadata || {}),
    },
  });
  return timestamp;
}

/**
 * Atomically increments the hit count and updates the lastAccessed timestamp for a memory item.
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
 * Adds a tactical lesson
 */
export async function addLesson(
  base: BaseMemoryProvider,
  userId: string,
  lesson: string,
  metadata?: InsightMetadata
): Promise<void> {
  const { expiresAt, type } = await RetentionManager.getExpiresAt('LESSON', userId);
  const timestamp = Date.now();
  await base.putItem({
    userId: `LESSON#${userId}`,
    timestamp,
    type,
    expiresAt,
    content: lesson,
    metadata: metadata || {
      category: InsightCategory.TACTICAL_LESSON,
      confidence: 5,
      impact: 5,
      complexity: 5,
      risk: 5,
      urgency: 5,
      priority: 5,
      hitCount: 0,
      lastAccessed: timestamp,
    },
  });
}

/**
 * Retrieves recent tactical lessons
 */
export async function getLessons(base: BaseMemoryProvider, userId: string): Promise<string[]> {
  const items = await base.queryItems({
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': `LESSON#${userId}`,
    },
    Limit: 10,
    ScanIndexForward: false,
  });
  return items.map((item) => item.content);
}

/**
 * Adds a new granular memory item into the user or global scope.
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

import { getRegisteredMemoryTypes, getMemoryByType } from './session-operations';

/**
 * Searches for insights across all categories
 */
export async function searchInsights(
  base: BaseMemoryProvider,
  userId: string,
  query: string,
  category?: InsightCategory
): Promise<MemoryInsight[]> {
  const scopes = [`USER#${userId}`, 'SYSTEM#GLOBAL', `LESSON#${userId}`, `DISTILLED#${userId}`];
  let allItems: Record<string, unknown>[] = [];

  // 1. Fetch by explicit partition keys
  for (const scope of scopes) {
    const items = await base.queryItems({
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': scope,
      },
      Limit: 50,
    });
    allItems = [...allItems, ...items];
  }

  // 2. Fetch GAPs properly using the GSI (since GAP# is a prefix, not a full PK)
  const gaps = await getMemoryByType(base, 'GAP', 50);
  allItems = [...allItems, ...gaps];

  // 3. Fetch dynamically registered types (if they aren't already captured by SYSTEM#GLOBAL or USER# scopes)
  const registeredTypes = await getRegisteredMemoryTypes(base);
  for (const rType of registeredTypes) {
    if (rType.startsWith('MEMORY:')) {
      const dynamicItems = await getMemoryByType(base, rType, 50);
      allItems = [...allItems, ...dynamicItems];
    }
  }

  // Deduplicate by userId and timestamp
  const uniqueItemsMap = new Map<string, Record<string, unknown>>();
  allItems.forEach((item) => {
    uniqueItemsMap.set(`${item.userId}-${item.timestamp}`, item);
  });

  let allInsights: MemoryInsight[] = Array.from(uniqueItemsMap.values()).map((item) => {
    const scope = item.userId as string;
    const metadata = (item.metadata as InsightMetadata) || {
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
      id: item.userId as string,
      content: item.content as string,
      metadata,
      timestamp: item.timestamp as number,
    };
  });

  if (category) {
    allInsights = allInsights.filter((i) => i.metadata.category === category);
  }

  if (query && query !== '*' && query !== '') {
    const lowerQuery = query.toLowerCase();
    allInsights = allInsights.filter((i) => i.content.toLowerCase().includes(lowerQuery));
  }

  return allInsights.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Updates metadata for a specific insight
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
    metadata: { ...(item.metadata || {}), ...metadata },
  });
}

/**
 * Retrieves memory items with low utilization (low hitCount and old lastAccessed).
 * Scans dynamically registered memory types.
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

    const stale = items.filter((item) => {
      const meta = item.metadata as InsightMetadata | undefined;
      if (!meta) return false;

      const isHitCountLow = meta.hitCount === undefined || meta.hitCount === 0;
      const lastAccessed = meta.lastAccessed || (item.timestamp as number) || now;
      const timeSinceAccess = now - lastAccessed;

      return isHitCountLow && timeSinceAccess > STALE_THRESHOLD_MS;
    });

    staleItems = [...staleItems, ...stale];
  }

  // Sort by oldest first and cap
  return staleItems
    .sort((a, b) => {
      const tA =
        (a.metadata as Record<string, unknown>)?.lastAccessed || (a.timestamp as number) || 0;
      const tB =
        (b.metadata as Record<string, unknown>)?.lastAccessed || (b.timestamp as number) || 0;
      return (tA as number) - (tB as number);
    })
    .slice(0, limit);
}
