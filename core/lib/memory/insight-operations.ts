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
  baseCategory: 'INSIGHT' | 'MEMORY',
  scopeId: string,
  category: InsightCategory | string,
  content: string,
  metadata?: Partial<InsightMetadata>
): Promise<number> {
  const { expiresAt } = await RetentionManager.getExpiresAt(baseCategory, scopeId);
  const timestamp = Date.now();
  await base.putItem({
    userId: scopeId,
    timestamp,
    type: `${baseCategory}:${category.toUpperCase()}`,
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
      ...(metadata || {}),
    },
  });
  return timestamp;
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
  await base.putItem({
    userId: `LESSON#${userId}`,
    timestamp: Date.now(),
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
 * Adds a new granular insight
 */
export async function addInsight(
  base: BaseMemoryProvider,
  scopeId: string,
  category: InsightCategory | string,
  content: string,
  metadata?: Partial<InsightMetadata>
): Promise<number> {
  return addRecord(base, 'INSIGHT', scopeId, category, content, metadata);
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

/**
 * Searches for insights across all categories
 */
export async function searchInsights(
  base: BaseMemoryProvider,
  userId: string,
  query: string,
  category?: InsightCategory
): Promise<MemoryInsight[]> {
  const scopes = [
    `USER#${userId}`,
    'SYSTEM#GLOBAL',
    `LESSON#${userId}`,
    `GAP#`,
    `DISTILLED#${userId}`,
  ];
  let allInsights: MemoryInsight[] = [];

  for (const scope of scopes) {
    const items = await base.queryItems({
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': scope,
      },
      Limit: 50,
    });

    const insights = items.map((item) => {
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
    allInsights = [...allInsights, ...insights];
  }

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
