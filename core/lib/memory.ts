import {
  IMemory,
  Message,
  InsightMetadata,
  MemoryInsight,
  InsightCategory,
  GapStatus,
  ConversationMeta,
} from './types/index';
import { logger } from './logger';
import { BaseMemoryProvider, docClient } from './memory/base';
import { RetentionManager } from './memory/tiering';
import { TIME, LIMITS } from './constants';

/**
 * Implementation of IMemory using AWS DynamoDB for persistent storage
 * with a tiered retention strategy.
 *
 * This class acts as a high-level facade orchestrating core storage (BaseMemoryProvider)
 * and data lifecycle management (RetentionManager).
 */
export class DynamoMemory extends BaseMemoryProvider implements IMemory {
  /**
   * Appends a new message with tiered retention.
   */
  async addMessage(userId: string, message: Message): Promise<void> {
    const { expiresAt, type } = await RetentionManager.getExpiresAt('MESSAGES', userId);
    await this.putItem({
      userId,
      timestamp: Date.now(),
      type,
      expiresAt,
      ...message,
    });
  }

  /**
   * Deletes a conversation session and its history
   */
  async deleteConversation(userId: string, sessionId: string): Promise<void> {
    const conversations = await this.listConversations(userId);
    const existing = conversations.find((c) => c.sessionId === sessionId);

    if (existing) {
      await this.deleteItem({
        userId: `SESSIONS#${userId}`,
        timestamp: existing.updatedAt,
      });
    }

    await this.clearHistory(`CONV#${userId}#${sessionId}`);
  }

  /**
   * Updates distilled memory with a 2-year retention policy
   */
  async updateDistilledMemory(userId: string, facts: string): Promise<void> {
    const { expiresAt, type } = await RetentionManager.getExpiresAt('DISTILLED', userId);
    await this.putItem({
      userId: `DISTILLED#${userId}`,
      timestamp: Date.now(),
      type,
      expiresAt,
      content: facts,
    });
  }

  /**
   * Retrieves all capability gaps filtered by status
   */
  async getAllGaps(status: GapStatus = GapStatus.OPEN): Promise<MemoryInsight[]> {
    const items = await this.queryItems({
      IndexName: 'TypeTimestampIndex',
      KeyConditionExpression: '#type = :type',
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#type': 'type',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':type': 'GAP',
        ':status': status,
      },
    });

    return items.map((item) => ({
      id: item.userId,
      content: item.content,
      timestamp: item.timestamp,
      metadata: item.metadata || {
        category: InsightCategory.STRATEGIC_GAP,
        confidence: 0,
        impact: 0,
        complexity: 0,
        risk: 0,
        urgency: 0,
        priority: 0,
      },
    }));
  }

  /**
   * Archives stale gaps that have been open for longer than the specified days.
   * Returns the number of gaps archived.
   */
  async archiveStaleGaps(staleDays: number = LIMITS.STALE_GAP_DAYS): Promise<number> {
    const cutoffTime = Date.now() - staleDays * TIME.SECONDS_IN_DAY * TIME.MS_PER_SECOND;

    // Get all OPEN and PLANNED gaps
    const items = await this.queryItems({
      IndexName: 'TypeTimestampIndex',
      KeyConditionExpression: '#type = :type',
      FilterExpression: '#status IN (:open, :planned)',
      ExpressionAttributeNames: {
        '#type': 'type',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':type': 'GAP',
        ':status': GapStatus.OPEN,
        ':planned': GapStatus.PLANNED,
      },
    });

    const staleGaps = items.filter((item) => item.timestamp && item.timestamp < cutoffTime);

    let archived = 0;
    for (const gap of staleGaps) {
      try {
        await this.updateItem({
          Key: {
            userId: gap.userId,
            timestamp: gap.timestamp,
          },
          UpdateExpression: 'SET #status = :archived, updatedAt = :now',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':archived': GapStatus.ARCHIVED,
            ':now': Date.now(),
          },
        });
        archived++;
        logger.info(`Archived stale gap: ${gap.userId}`);
      } catch (error) {
        logger.warn(`Failed to archive gap ${gap.userId}:`, error);
      }
    }

    if (archived > 0) {
      logger.info(`Archived ${archived} stale gaps older than ${staleDays} days`);
    }

    return archived;
  }

  /**
   * Records a new capability gap
   */
  async setGap(gapId: string, details: string, metadata?: InsightMetadata): Promise<void> {
    const { expiresAt, type } = await RetentionManager.getExpiresAt('GAP', '');
    await this.putItem({
      userId: `GAP#${gapId}`,
      timestamp: parseInt(gapId, 10) || Date.now(),
      type,
      expiresAt,
      content: details,
      status: GapStatus.OPEN,
      metadata: metadata || {
        category: InsightCategory.STRATEGIC_GAP,
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
   * Atomically increments the attempt counter on a capability gap and returns the new count.
   * Used by the self-healing loop to cap infinite reopen/redeploy cycles.
   */
  async incrementGapAttemptCount(gapId: string): Promise<number> {
    const numericId = gapId.replace('GAP#', '');
    try {
      const result = await this.updateItem({
        Key: {
          userId: `GAP#${numericId}`,
          timestamp: parseInt(numericId, 10) || 0,
        },
        UpdateExpression:
          'SET attemptCount = if_not_exists(attemptCount, :zero) + :one, updatedAt = :now',
        ExpressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':now': Date.now(),
        },
        ReturnValues: 'ALL_NEW',
      });
      return (result.Attributes?.attemptCount as number) ?? 1;
    } catch (error) {
      logger.error(`Error incrementing attempt count for gap ${gapId}:`, error);
      return 1;
    }
  }

  /**
   * Transitions a capability gap to a new status
   */
  async updateGapStatus(gapId: string, status: GapStatus): Promise<void> {
    const numericId = gapId.replace('GAP#', '');
    const params: any = {
      Key: {
        userId: `GAP#${numericId}`,
        timestamp: parseInt(numericId, 10) || 0,
      },
      UpdateExpression: 'SET #status = :status, updatedAt = :now',
      ConditionExpression: 'attribute_exists(userId)',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':now': Date.now(),
      },
    };

    // Strategy 2: If primary key fails, search and retry exactly ONCE with specific timestamp
    if (isNaN(parseInt(numericId, 10)) || params.Key?.timestamp === 0) {
      const allStatuses = Object.values(GapStatus);
      let found = false;
      for (const s of allStatuses) {
        const gaps = await this.getAllGaps(s);
        const target = gaps.find((g) => g.id === `GAP#${numericId}`);
        if (target) {
          params.Key = { userId: `GAP#${numericId}`, timestamp: target.timestamp };
          found = true;
          break;
        }
      }
      if (!found) {
        logger.error(`Gap update aborted: ID ${gapId} not found in any status.`);
        return;
      }
    }

    try {
      await this.updateItem(params);
    } catch (error) {
      const err = error as { name?: string };
      if (err.name === 'ConditionalCheckFailedException') {
        logger.warn(
          `Gap update race condition or missing item: ${gapId}. Retrying with fresh lookup.`
        );
        // Final desperate attempted lookup to see if timestamp shifted
        const all = await this.getAllGaps();
        const retryTarget = all.find((g) => g.id === `GAP#${numericId}`);
        if (retryTarget) {
          params.Key = { userId: `GAP#${numericId}`, timestamp: retryTarget.timestamp };
          await this.updateItem(params);
        }
      } else {
        logger.error(`Error updating gap ${gapId} status:`, error);
      }
    }
  }

  /**
   * Adds a tactical lesson
   */
  async addLesson(userId: string, lesson: string, metadata?: InsightMetadata): Promise<void> {
    const { expiresAt, type } = await RetentionManager.getExpiresAt('LESSON', userId);
    await this.putItem({
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
  async getLessons(userId: string): Promise<string[]> {
    const items = await this.queryItems({
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
  async addInsight(
    scopeId: string,
    category: InsightCategory | string,
    content: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number> {
    return this._addRecord('INSIGHT', scopeId, category, content, metadata);
  }

  /**
   * Adds a new granular memory item into the user or global scope.
   */
  async addMemory(
    scopeId: string,
    category: InsightCategory | string,
    content: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number> {
    return this._addRecord('MEMORY', scopeId, category, content, metadata);
  }

  /**
   * Shared implementation for adding granular records (Insights/Memories)
   */
  private async _addRecord(
    baseCategory: 'INSIGHT' | 'MEMORY',
    scopeId: string,
    category: InsightCategory | string,
    content: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number> {
    const { expiresAt } = await RetentionManager.getExpiresAt(baseCategory, scopeId);
    const timestamp = Date.now();
    await this.putItem({
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
   * Searches for insights across all categories
   */
  async searchInsights(
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
      const items = await this.queryItems({
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
  async updateInsightMetadata(
    userId: string,
    timestamp: number,
    metadata: Partial<InsightMetadata>
  ): Promise<void> {
    const items = await this.queryItems({
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

    await this.putItem({
      ...item,
      metadata: { ...(item.metadata || {}), ...metadata },
    });
  }

  /**
   * Saves or updates session metadata
   */
  async saveConversationMeta(
    userId: string,
    sessionId: string,
    meta: Partial<ConversationMeta>
  ): Promise<void> {
    const conversations = await this.listConversations(userId);
    const existing = conversations.find((c) => c.sessionId === sessionId);

    if (existing) {
      await this.deleteItem({
        userId: `SESSIONS#${userId}`,
        timestamp: existing.updatedAt,
      });
    }

    const { expiresAt, type } = await RetentionManager.getExpiresAt('SESSIONS', userId);
    await this.putItem({
      userId: `SESSIONS#${userId}`,
      timestamp: Date.now(),
      type,
      expiresAt,
      sessionId,
      title: meta.title || existing?.title || 'New Conversation',
      content: meta.lastMessage || existing?.lastMessage || '',
    });
  }

  /**
   * Universal fetcher for memory items by their type using the GSI.
   */
  async getMemoryByType(type: string, limit: number = 100): Promise<Record<string, unknown>[]> {
    return (await this.queryItems({
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
   * Saves the Last Known Good (LKG) commit hash after a successful health check.
   */
  async saveLKGHash(hash: string): Promise<void> {
    const { expiresAt, type } = await RetentionManager.getExpiresAt('DISTILLED', 'SYSTEM#LKG');
    await this.putItem({
      userId: 'SYSTEM#LKG',
      timestamp: Date.now(),
      type,
      expiresAt,
      content: hash,
    });
    logger.info(`Saved new Last Known Good (LKG) hash: ${hash}`);
  }

  /**
   * Retrieves the most recent Last Known Good (LKG) commit hash.
   */
  async getLatestLKGHash(): Promise<string | null> {
    const items = await this.queryItems({
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': 'SYSTEM#LKG',
      },
      Limit: 1,
      ScanIndexForward: false,
    });

    return (items[0]?.content as string) || null;
  }

  /**
   * Atomically increments the system-wide recovery attempt count.
   */
  async incrementRecoveryAttemptCount(): Promise<number> {
    const result = await this.updateItem({
      Key: {
        userId: 'SYSTEM#RECOVERY#STATS',
        timestamp: 0,
      },
      UpdateExpression: 'SET attempts = if_not_exists(attempts, :zero) + :one, updatedAt = :now',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':now': Date.now(),
      },
      ReturnValues: 'ALL_NEW',
    });

    return (result.Attributes?.attempts as number) ?? 1;
  }

  /**
   * Resets the system-wide recovery attempt count.
   */
  async resetRecoveryAttemptCount(): Promise<void> {
    await this.updateItem({
      Key: {
        userId: 'SYSTEM#RECOVERY#STATS',
        timestamp: 0,
      },
      UpdateExpression: 'SET attempts = :zero, updatedAt = :now',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':now': Date.now(),
      },
    });
  }
}
