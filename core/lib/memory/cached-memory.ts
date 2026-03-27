/**
 * @module CachedMemory
 * @description Wrapper for DynamoMemory that adds LRU caching for frequently accessed items.
 * Reduces DynamoDB read operations while maintaining data consistency through proper cache invalidation.
 */

import {
  IMemory,
  Message,
  InsightMetadata,
  MemoryInsight,
  InsightCategory,
  GapStatus,
  ConversationMeta,
} from '../types/index';
import { DynamoMemory } from '../memory';
import { MemoryCaches, CacheKeys, getCacheStatsSummary } from './cache';
import { logger } from '../logger';

/**
 * Cached memory provider that wraps DynamoMemory with LRU caching.
 * Implements cache-aside pattern with proper invalidation on writes.
 */
export class CachedMemory implements IMemory {
  constructor(private readonly underlying: DynamoMemory) {}

  /**
   * Gets conversation history with caching.
   * Cache is invalidated when new messages are added.
   */
  async getHistory(userId: string): Promise<Message[]> {
    const cacheKey = CacheKeys.history(userId);
    const cached = MemoryCaches.conversation.get(cacheKey) as Message[] | undefined;

    if (cached) {
      logger.debug(`Cache hit for history: ${userId}`);
      return cached;
    }

    logger.debug(`Cache miss for history: ${userId}`);
    const history = await this.underlying.getHistory(userId);

    // Cache history with 2 minute TTL
    MemoryCaches.conversation.set(cacheKey, history, 2 * 60 * 1000);

    return history;
  }

  /**
   * Adds a message and invalidates relevant caches.
   */
  async addMessage(userId: string, message: Message): Promise<void> {
    await this.underlying.addMessage(userId, message);

    // Invalidate conversation cache for this user
    MemoryCaches.conversation.delete(CacheKeys.history(userId));
    MemoryCaches.conversation.delete(CacheKeys.summary(userId));
  }

  /**
   * Gets distilled memory with caching.
   * Uses 5 minute TTL for user data.
   */
  async getDistilledMemory(userId: string): Promise<string> {
    const cacheKey = CacheKeys.distilledMemory(userId);
    const cached = MemoryCaches.userData.get(cacheKey) as string | undefined;

    if (cached !== undefined) {
      logger.debug(`Cache hit for distilled memory: ${userId}`);
      return cached;
    }

    logger.debug(`Cache miss for distilled memory: ${userId}`);
    const distilled = await this.underlying.getDistilledMemory(userId);

    // Cache distilled memory with 5 minute TTL
    MemoryCaches.userData.set(cacheKey, distilled, 5 * 60 * 1000);

    return distilled;
  }

  /**
   * Updates distilled memory and invalidates cache.
   */
  async updateDistilledMemory(userId: string, facts: string): Promise<void> {
    await this.underlying.updateDistilledMemory(userId, facts);

    // Invalidate user data cache
    MemoryCaches.userData.delete(CacheKeys.distilledMemory(userId));
  }

  /**
   * Gets lessons with caching.
   */
  async getLessons(userId: string): Promise<string[]> {
    const cacheKey = CacheKeys.lessons(userId);
    const cached = MemoryCaches.userData.get(cacheKey) as string[] | undefined;

    if (cached) {
      logger.debug(`Cache hit for lessons: ${userId}`);
      return cached;
    }

    logger.debug(`Cache miss for lessons: ${userId}`);
    const lessons = await this.underlying.getLessons(userId);

    // Cache lessons with 5 minute TTL
    MemoryCaches.userData.set(cacheKey, lessons, 5 * 60 * 1000);

    return lessons;
  }

  /**
   * Adds a lesson and invalidates cache.
   */
  async addLesson(userId: string, lesson: string, metadata?: InsightMetadata): Promise<void> {
    await this.underlying.addLesson(userId, lesson, metadata);

    // Invalidate lessons cache
    MemoryCaches.userData.delete(CacheKeys.lessons(userId));
  }

  /**
   * Gets conversation summary with caching.
   */
  async getSummary(userId: string): Promise<string | null> {
    const cacheKey = CacheKeys.summary(userId);
    const cached = MemoryCaches.conversation.get(cacheKey) as string | null | undefined;

    if (cached !== undefined) {
      logger.debug(`Cache hit for summary: ${userId}`);
      return cached;
    }

    logger.debug(`Cache miss for summary: ${userId}`);
    const summary = await this.underlying.getSummary(userId);

    // Cache summary with 2 minute TTL
    MemoryCaches.conversation.set(cacheKey, summary, 2 * 60 * 1000);

    return summary;
  }

  /**
   * Updates summary and invalidates cache.
   */
  async updateSummary(userId: string, summary: string): Promise<void> {
    await this.underlying.updateSummary(userId, summary);

    // Invalidate summary cache
    MemoryCaches.conversation.delete(CacheKeys.summary(userId));
  }

  /**
   * Gets global lessons with caching.
   * Uses 15 minute TTL for system-wide data.
   */
  async getGlobalLessons(limit?: number): Promise<string[]> {
    const effectiveLimit = limit ?? 5;
    const cacheKey = CacheKeys.globalLessons(effectiveLimit);
    const cached = MemoryCaches.global.get(cacheKey) as string[] | undefined;

    if (cached) {
      logger.debug(`Cache hit for global lessons (limit: ${effectiveLimit})`);
      return cached;
    }

    logger.debug(`Cache miss for global lessons (limit: ${effectiveLimit})`);
    const lessons = await this.underlying.getGlobalLessons(effectiveLimit);

    // Cache global lessons with 15 minute TTL
    MemoryCaches.global.set(cacheKey, lessons, 15 * 60 * 1000);

    return lessons;
  }

  /**
   * Adds a global lesson and invalidates cache.
   */
  async addGlobalLesson(lesson: string, metadata?: Partial<InsightMetadata>): Promise<number> {
    const result = await this.underlying.addGlobalLesson(lesson, metadata);

    // Invalidate all global lessons caches (different limits)
    MemoryCaches.global.invalidatePattern(/^global_lessons:/);

    return result;
  }

  /**
   * Searches insights with caching for repeated queries.
   */
  async searchInsights(
    userId?: string,
    query: string = '',
    category?: InsightCategory,
    limit: number = 50,
    lastEvaluatedKey?: Record<string, unknown>
  ): Promise<{ items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }> {
    // Don't cache paginated results
    if (lastEvaluatedKey) {
      return this.underlying.searchInsights(userId, query, category, limit, lastEvaluatedKey);
    }

    const cacheKey = CacheKeys.insightsSearch(userId ?? 'global', query, category);
    const cached = MemoryCaches.search.get(cacheKey) as
      | {
          items: MemoryInsight[];
          lastEvaluatedKey?: Record<string, unknown>;
        }
      | undefined;

    if (cached) {
      logger.debug(`Cache hit for insights search: ${cacheKey}`);
      return cached;
    }

    logger.debug(`Cache miss for insights search: ${cacheKey}`);
    const result = await this.underlying.searchInsights(userId, query, category, limit);

    // Cache search results with 3 minute TTL
    MemoryCaches.search.set(cacheKey, result, 3 * 60 * 1000);

    return result;
  }

  /**
   * Adds memory and invalidates related search caches.
   */
  async addMemory(
    scopeId: string,
    category: InsightCategory | string,
    content: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number> {
    const result = await this.underlying.addMemory(scopeId, category, content, metadata);

    // Invalidate search caches that might be affected
    MemoryCaches.search.invalidatePattern(new RegExp(`^insights:${scopeId}:`));

    return result;
  }

  /**
   * Gets all gaps with caching by status.
   */
  async getAllGaps(status: GapStatus = GapStatus.OPEN): Promise<MemoryInsight[]> {
    const cacheKey = CacheKeys.gapsByStatus(status);
    const cached = MemoryCaches.global.get(cacheKey) as MemoryInsight[] | undefined;

    if (cached) {
      logger.debug(`Cache hit for gaps by status: ${status}`);
      return cached;
    }

    logger.debug(`Cache miss for gaps by status: ${status}`);
    const gaps = await this.underlying.getAllGaps(status);

    // Cache gaps with 5 minute TTL
    MemoryCaches.global.set(cacheKey, gaps, 5 * 60 * 1000);

    return gaps;
  }

  /**
   * Sets a gap and invalidates cache.
   */
  async setGap(gapId: string, details: string, metadata?: InsightMetadata): Promise<void> {
    await this.underlying.setGap(gapId, details, metadata);

    // Invalidate gaps cache
    MemoryCaches.global.invalidatePattern(/^gaps:/);
  }

  /**
   * Updates gap status and invalidates cache.
   */
  async updateGapStatus(gapId: string, status: GapStatus): Promise<void> {
    await this.underlying.updateGapStatus(gapId, status);

    // Invalidate gaps cache
    MemoryCaches.global.invalidatePattern(/^gaps:/);
  }

  /**
   * Gets user preferences with caching.
   */
  async searchInsightsForPreferences(
    userId: string
  ): Promise<{ prefixed: MemoryInsight[]; raw: MemoryInsight[] }> {
    const prefixedKey = `${userId}-prefixed`;
    const rawKey = `${userId}-raw`;

    const cachedPrefixed = MemoryCaches.userData.get(prefixedKey) as MemoryInsight[] | undefined;
    const cachedRaw = MemoryCaches.userData.get(rawKey) as MemoryInsight[] | undefined;

    if (cachedPrefixed && cachedRaw) {
      logger.debug(`Cache hit for user preferences: ${userId}`);
      return { prefixed: cachedPrefixed, raw: cachedRaw };
    }

    logger.debug(`Cache miss for user preferences: ${userId}`);
    const [prefixed, raw] = await Promise.all([
      this.underlying.searchInsights(`USER#${userId}`, '*', InsightCategory.USER_PREFERENCE),
      this.underlying.searchInsights(userId, '*', InsightCategory.USER_PREFERENCE),
    ]);

    // Cache preferences with 5 minute TTL
    MemoryCaches.userData.set(prefixedKey, prefixed.items, 5 * 60 * 1000);
    MemoryCaches.userData.set(rawKey, raw.items, 5 * 60 * 1000);

    return { prefixed: prefixed.items, raw: raw.items };
  }

  // Delegate all other methods directly to underlying memory
  async clearHistory(userId: string): Promise<void> {
    await this.underlying.clearHistory(userId);
    MemoryCaches.conversation.delete(CacheKeys.history(userId));
    MemoryCaches.conversation.delete(CacheKeys.summary(userId));
  }

  async listConversations(userId: string): Promise<ConversationMeta[]> {
    return this.underlying.listConversations(userId);
  }

  async deleteConversation(userId: string, sessionId: string): Promise<void> {
    await this.underlying.deleteConversation(userId, sessionId);
    MemoryCaches.conversation.delete(CacheKeys.history(userId));
  }

  async archiveStaleGaps(staleDays?: number): Promise<number> {
    const result = await this.underlying.archiveStaleGaps(staleDays);
    MemoryCaches.global.invalidatePattern(/^gaps:/);
    return result;
  }

  async incrementGapAttemptCount(gapId: string): Promise<number> {
    return this.underlying.incrementGapAttemptCount(gapId);
  }

  async updateInsightMetadata(
    userId: string,
    timestamp: number,
    metadata: Partial<InsightMetadata>
  ): Promise<void> {
    await this.underlying.updateInsightMetadata(userId, timestamp, metadata);
    MemoryCaches.search.invalidatePattern(new RegExp(`^insights:${userId}:`));
  }

  async saveConversationMeta(
    userId: string,
    sessionId: string,
    meta: Partial<ConversationMeta>
  ): Promise<void> {
    await this.underlying.saveConversationMeta(userId, sessionId, meta);
  }

  async getMemoryByTypePaginated(
    type: string,
    limit?: number,
    lastEvaluatedKey?: Record<string, unknown>
  ): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
    return this.underlying.getMemoryByTypePaginated(type, limit, lastEvaluatedKey);
  }

  async getMemoryByType(type: string, limit?: number): Promise<Record<string, unknown>[]> {
    return this.underlying.getMemoryByType(type, limit);
  }

  async getLowUtilizationMemory(limit?: number): Promise<Record<string, unknown>[]> {
    return this.underlying.getLowUtilizationMemory(limit);
  }

  async getRegisteredMemoryTypes(): Promise<string[]> {
    return this.underlying.getRegisteredMemoryTypes();
  }

  async recordMemoryHit(userId: string, timestamp: number): Promise<void> {
    await this.underlying.recordMemoryHit(userId, timestamp);
  }

  async saveLKGHash(hash: string): Promise<void> {
    await this.underlying.saveLKGHash(hash);
    MemoryCaches.global.delete('lkg_hash');
  }

  async getLatestLKGHash(): Promise<string | null> {
    const cacheKey = 'lkg_hash';
    const cached = MemoryCaches.global.get(cacheKey) as string | null | undefined;

    if (cached !== undefined) {
      return cached;
    }

    const hash = await this.underlying.getLatestLKGHash();
    MemoryCaches.global.set(cacheKey, hash, 15 * 60 * 1000);

    return hash;
  }

  async incrementRecoveryAttemptCount(): Promise<number> {
    return this.underlying.incrementRecoveryAttemptCount();
  }

  async resetRecoveryAttemptCount(): Promise<void> {
    await this.underlying.resetRecoveryAttemptCount();
  }

  async listByPrefix(prefix: string): Promise<Record<string, unknown>[]> {
    return this.underlying.listByPrefix(prefix);
  }

  async saveClarificationRequest(
    state: Omit<import('../types/memory').ClarificationState, 'type' | 'expiresAt' | 'timestamp'>
  ): Promise<void> {
    await this.underlying.saveClarificationRequest(state);
  }

  async getClarificationRequest(
    traceId: string,
    agentId: string
  ): Promise<import('../types/memory').ClarificationState | null> {
    return this.underlying.getClarificationRequest(traceId, agentId);
  }

  async updateClarificationStatus(
    traceId: string,
    agentId: string,
    status: import('../types/memory').ClarificationStatus
  ): Promise<void> {
    await this.underlying.updateClarificationStatus(traceId, agentId, status);
  }

  async saveEscalationState(state: import('../types/escalation').EscalationState): Promise<void> {
    await this.underlying.saveEscalationState(state);
  }

  async getEscalationState(
    traceId: string,
    agentId: string
  ): Promise<import('../types/escalation').EscalationState | null> {
    return this.underlying.getEscalationState(traceId, agentId);
  }

  async findExpiredClarifications(): Promise<import('../types/memory').ClarificationState[]> {
    return this.underlying.findExpiredClarifications();
  }

  async incrementClarificationRetry(traceId: string, agentId: string): Promise<number> {
    return this.underlying.incrementClarificationRetry(traceId, agentId);
  }

  async recordFailurePattern(
    scopeId: string,
    content: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number> {
    const result = await this.underlying.recordFailurePattern(scopeId, content, metadata);
    MemoryCaches.search.invalidatePattern(/^insights:/);
    return result;
  }

  async getFailurePatterns(
    scopeId: string,
    context?: string,
    limit?: number
  ): Promise<MemoryInsight[]> {
    return this.underlying.getFailurePatterns(scopeId, context, limit);
  }

  async acquireGapLock(gapId: string, agentId: string, ttlMs?: number): Promise<boolean> {
    return this.underlying.acquireGapLock(gapId, agentId, ttlMs);
  }

  async releaseGapLock(gapId: string, agentId: string): Promise<void> {
    await this.underlying.releaseGapLock(gapId, agentId);
  }

  async getGapLock(gapId: string): Promise<{ content: string; expiresAt: number } | null> {
    return this.underlying.getGapLock(gapId);
  }

  async recordFailedPlan(
    planHash: string,
    planContent: string,
    gapIds: string[],
    failureReason: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number> {
    const result = await this.underlying.recordFailedPlan(
      planHash,
      planContent,
      gapIds,
      failureReason,
      metadata
    );
    MemoryCaches.search.invalidatePattern(/^insights:/);
    return result;
  }

  async getFailedPlans(limit?: number): Promise<MemoryInsight[]> {
    return this.underlying.getFailedPlans(limit);
  }

  /**
   * Gets cache statistics for monitoring.
   */
  getCacheStats() {
    return getCacheStatsSummary();
  }

  /**
   * Clears all caches. Useful for testing or forced refresh.
   */
  clearAllCaches(): void {
    MemoryCaches.userData.clear();
    MemoryCaches.conversation.clear();
    MemoryCaches.global.clear();
    MemoryCaches.search.clear();
    logger.info('All memory caches cleared');
  }
}
