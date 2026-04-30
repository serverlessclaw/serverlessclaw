/**
 * @module CachedMemory
 * @description Wrapper for DynamoMemory that adds LRU caching for frequently accessed items.
 */

import {
  IMemory,
  Message,
  MemoryInsight,
  InsightCategory,
  GapStatus,
  GapTransitionResult,
  ConversationMeta,
  ClarificationState,
  ClarificationStatus,
  InsightMetadata,
  ContextualScope,
} from '../types/index';
import type { EscalationState } from '../types/escalation';
import type { CollaborationRole, ParticipantType } from '../types/collaboration';
import { DynamoMemory } from './dynamo-memory';
import { MemoryCaches, CacheKeys, getCacheStatsSummary } from './cache';
import { logger } from '../logger';
import { CACHE_TTL } from '../constants/memory';

// Decomposed operation handlers
import { MemoryDelegator } from './cached/delegator';
import { MemoryCollaboration } from './cached/collaboration';
import { MemoryGaps } from './cached/gaps';

/**
 * Cached memory provider that wraps DynamoMemory with LRU caching.
 * Implements cache-aside pattern with proper invalidation on writes.
 */
export class CachedMemory implements IMemory {
  private historyPromises: Map<string, Promise<Message[]>> = new Map();
  private delegator: MemoryDelegator;
  private collaboration: MemoryCollaboration;
  private gaps: MemoryGaps;

  constructor(private readonly underlying: DynamoMemory) {
    this.delegator = new MemoryDelegator(underlying);
    this.collaboration = new MemoryCollaboration(underlying);
    this.gaps = new MemoryGaps(underlying);
  }

  // --- CORE CONVERSATION OPERATIONS ---

  async getHistory(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<Message[]> {
    const cacheKey = CacheKeys.history(userId, scope);
    const cached = MemoryCaches.conversation.get(cacheKey) as Message[] | undefined;

    if (cached) {
      logger.debug(`Cache hit for history: ${userId}`);
      return cached;
    }

    const existingPromise = this.historyPromises.get(cacheKey);
    if (existingPromise) {
      logger.debug(`Coalescing concurrent history request for: ${userId}`);
      return existingPromise;
    }

    logger.debug(`Cache miss for history: ${userId}`);
    const promise = this.underlying.getHistory(userId, scope).finally(() => {
      this.historyPromises.delete(cacheKey);
    });

    this.historyPromises.set(cacheKey, promise);
    const history = await promise;
    MemoryCaches.conversation.set(cacheKey, history, CACHE_TTL.CONVERSATION);
    return history;
  }

  async addMessage(
    userId: string,
    message: Message,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.addMessage(userId, message, scope);
    MemoryCaches.conversation.delete(CacheKeys.history(userId, scope));
    MemoryCaches.conversation.delete(CacheKeys.summary(userId, scope));
  }

  async getSummary(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<string | null> {
    const cacheKey = CacheKeys.summary(userId, scope);
    const cached = MemoryCaches.conversation.get(cacheKey) as string | null | undefined;

    if (cached !== undefined) {
      logger.debug(`Cache hit for summary: ${userId}`);
      return cached;
    }

    const summary = await this.underlying.getSummary(userId, scope);
    MemoryCaches.conversation.set(cacheKey, summary, CACHE_TTL.CONVERSATION);
    return summary;
  }

  async updateSummary(
    userId: string,
    summary: string,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.updateSummary(userId, summary, scope);
    MemoryCaches.conversation.delete(CacheKeys.summary(userId, scope));
  }

  async listConversations(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<ConversationMeta[]> {
    return this.underlying.listConversations(userId, scope);
  }

  async deleteConversation(
    userId: string,
    sessionId: string,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.deleteConversation(userId, sessionId, scope);
    MemoryCaches.conversation.delete(CacheKeys.history(userId, scope));
  }

  async saveConversationMeta(
    userId: string,
    sessionId: string,
    meta: Partial<ConversationMeta>,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.saveConversationMeta(userId, sessionId, meta, scope);
    MemoryCaches.conversation.delete(CacheKeys.history(userId, scope));
    MemoryCaches.conversation.delete(CacheKeys.summary(userId, scope));
  }

  // --- USER DATA & INSIGHTS ---

  async getDistilledMemory(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<string> {
    const cacheKey = CacheKeys.distilledMemory(userId, scope);
    const cached = MemoryCaches.userData.get(cacheKey) as string | undefined;

    if (cached !== undefined) return cached;

    const distilled = await this.underlying.getDistilledMemory(userId, scope);
    MemoryCaches.userData.set(cacheKey, distilled, CACHE_TTL.USER_DATA);
    return distilled;
  }

  async updateDistilledMemory(
    userId: string,
    facts: string,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.updateDistilledMemory(userId, facts, scope);
    MemoryCaches.userData.delete(CacheKeys.distilledMemory(userId, scope));
  }

  async getLessons(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<string[]> {
    const cacheKey = CacheKeys.lessons(userId, scope);
    const cached = MemoryCaches.userData.get(cacheKey) as string[] | undefined;

    if (cached) return cached;

    const lessons = await this.underlying.getLessons(userId, scope);
    MemoryCaches.userData.set(cacheKey, lessons, CACHE_TTL.USER_DATA);
    return lessons;
  }

  async addLesson(
    userId: string,
    lesson: string,
    metadata?: Partial<InsightMetadata> & { tags?: string[] },
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.addLesson(userId, lesson, metadata as InsightMetadata, scope);
    MemoryCaches.userData.delete(CacheKeys.lessons(userId, scope));
  }

  async getGlobalLessons(limit?: number): Promise<string[]> {
    const effectiveLimit = limit ?? 5;
    const cacheKey = CacheKeys.globalLessons(effectiveLimit);
    const cached = MemoryCaches.global.get(cacheKey) as string[] | undefined;

    if (cached) return cached;

    const lessons = await this.underlying.getGlobalLessons(effectiveLimit);
    MemoryCaches.global.set(cacheKey, lessons, CACHE_TTL.GLOBAL);
    return lessons;
  }

  async addGlobalLesson(
    lesson: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number | string> {
    const result = await this.underlying.addGlobalLesson(lesson, metadata);
    MemoryCaches.global.invalidatePattern(/^global_lessons:/);
    return result;
  }

  async searchInsights(
    queryOrUserId?:
      | string
      | {
          query?: string;
          tags?: string[];
          category?: InsightCategory;
          limit?: number;
          scope?: ContextualScope;
        },
    queryText?: string,
    category?: InsightCategory,
    limit?: number,
    lastEvaluatedKey?: Record<string, unknown>,
    tags?: string[],
    orgId?: string,
    scope?: string | ContextualScope
  ): Promise<{ items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }> {
    // Reconstruct arguments if object is passed
    let effectiveUserId: string;
    let effectiveQuery: string;
    let effectiveCategory: InsightCategory | undefined;
    let effectiveTags: string[] | undefined;
    let effectiveScope: string | ContextualScope | undefined;

    if (typeof queryOrUserId === 'object' && queryOrUserId !== null) {
      effectiveUserId = ((queryOrUserId as Record<string, unknown>).userId as string) || '';
      effectiveQuery = ((queryOrUserId as Record<string, unknown>).query as string) || '';
      effectiveCategory = queryOrUserId.category;
      effectiveTags = queryOrUserId.tags;
      effectiveScope = queryOrUserId.scope;
    } else {
      effectiveUserId = (queryOrUserId as string) || '';
      effectiveQuery = queryText || '';
      effectiveCategory = category;
      effectiveTags = tags;
      effectiveScope = scope;
    }

    const cacheKey = CacheKeys.insightsSearch(
      effectiveUserId,
      effectiveQuery,
      effectiveCategory,
      effectiveTags,
      orgId,
      effectiveScope
    );

    const cached = MemoryCaches.search.get(cacheKey) as
      | { items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }
      | undefined;
    if (cached) return cached;

    const result = await this.underlying.searchInsights(
      queryOrUserId,
      queryText,
      category,
      limit,
      lastEvaluatedKey,
      tags,
      orgId,
      scope
    );

    MemoryCaches.search.set(cacheKey, result, CACHE_TTL.SEARCH);
    return result;
  }

  async recordFailurePattern(
    planHash: string,
    planContent: string,
    gapIds: string[],
    failureReason: string,
    metadata?: Partial<InsightMetadata>,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<number | string> {
    return this.underlying.recordFailurePattern(
      planHash,
      planContent,
      gapIds,
      failureReason,
      metadata,
      scope
    );
  }

  async getFailurePatterns(
    limit?: number,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<MemoryInsight[]> {
    return this.underlying.getFailurePatterns(limit, scope);
  }

  async addMemory(
    scopeId: string,
    category: InsightCategory | string,
    content: string,
    metadata?: Partial<InsightMetadata> & { orgId?: string; tags?: string[] },
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<number | string> {
    const result = await this.underlying.addMemory(scopeId, category, content, metadata, scope);
    MemoryCaches.search.invalidatePattern(new RegExp(`^insights:${scopeId}:`));
    return result;
  }

  /**
   * Saves a distilled recovery log for emergency rollback context.
   */
  async saveDistilledRecoveryLog(traceId: string, task: string): Promise<void> {
    return this.underlying.saveDistilledRecoveryLog(traceId, task);
  }

  async searchInsightsForPreferences(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<{ prefixed: MemoryInsight[]; raw: MemoryInsight[] }> {
    const prefixedKey = `prefs:${userId}:prefixed${CacheKeys.normalizeScope(scope)}`;
    const rawKey = `prefs:${userId}:raw${CacheKeys.normalizeScope(scope)}`;

    const cachedPrefixed = MemoryCaches.userData.get(prefixedKey) as MemoryInsight[] | undefined;
    const cachedRaw = MemoryCaches.userData.get(rawKey) as MemoryInsight[] | undefined;

    if (cachedPrefixed && cachedRaw) return { prefixed: cachedPrefixed, raw: cachedRaw };

    const [prefixed, raw] = await Promise.all([
      this.underlying.searchInsights(
        `USER#${userId}`,
        '*',
        InsightCategory.USER_PREFERENCE,
        50,
        undefined,
        undefined,
        undefined,
        scope
      ),
      this.underlying.searchInsights(
        userId,
        '*',
        InsightCategory.USER_PREFERENCE,
        50,
        undefined,
        undefined,
        undefined,
        scope
      ),
    ]);

    MemoryCaches.userData.set(prefixedKey, prefixed.items, CACHE_TTL.USER_DATA);
    MemoryCaches.userData.set(rawKey, raw.items, CACHE_TTL.USER_DATA);
    return { prefixed: prefixed.items, raw: raw.items };
  }

  async updateInsightMetadata(
    userId: string,
    timestamp: number | string,
    metadata: Partial<InsightMetadata>,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.updateInsightMetadata(userId, timestamp, metadata, scope);
    MemoryCaches.search.invalidatePattern(new RegExp(`^insights:${userId}:`));
  }

  async refineMemory(
    userId: string,
    timestamp: number | string,
    content?: string,
    metadata?: Partial<InsightMetadata> & { tags?: string[] },
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.refineMemory(userId, timestamp, content, metadata, scope);
    MemoryCaches.search.invalidatePattern(new RegExp(`^insights:${userId}:`));
    if (metadata?.category)
      MemoryCaches.search.invalidatePattern(new RegExp(`:${metadata.category}`));
  }

  // --- GAP & PLAN OPERATIONS (Delegated) ---

  async getAllGaps(
    status: GapStatus = GapStatus.OPEN,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<MemoryInsight[]> {
    return this.gaps.getAllGaps(status, scope);
  }
  async setGap(
    gapId: string,
    details: string,
    metadata?: InsightMetadata,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<void> {
    return this.gaps.setGap(gapId, details, metadata, scope);
  }
  async updateGapStatus(
    gapId: string,
    status: GapStatus,
    scope?: string | import('../types/memory').ContextualScope,
    metadata?: Record<string, unknown>
  ): Promise<GapTransitionResult> {
    return this.gaps.updateGapStatus(gapId, status, scope, metadata);
  }
  async archiveStaleGaps(
    staleDays?: number,
    scope?: string | import('../types/index').ContextualScope
  ): Promise<number> {
    return this.gaps.archiveStaleGaps(staleDays, scope);
  }
  async cullResolvedGaps(
    thresholdDays?: number,
    scope?: string | import('../types/index').ContextualScope
  ): Promise<number> {
    return this.underlying.cullResolvedGaps(thresholdDays, scope);
  }
  async incrementGapAttemptCount(
    gapId: string,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<number> {
    return this.gaps.incrementGapAttemptCount(gapId, scope);
  }
  async updateGapMetadata(
    gapId: string,
    metadata: Partial<InsightMetadata>,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<void> {
    return this.gaps.updateGapMetadata(gapId, metadata, scope);
  }
  async getGap(
    gapId: string,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<MemoryInsight | null> {
    return this.gaps.getGap(gapId, scope);
  }
  async acquireGapLock(
    gapId: string,
    agentId: string,
    ttlMs?: number,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<boolean> {
    return this.gaps.acquireGapLock(gapId, agentId, ttlMs, scope);
  }
  async releaseGapLock(
    gapId: string,
    agentId: string,
    expectedVersion?: number,
    force?: boolean,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<void> {
    return this.gaps.releaseGapLock(gapId, agentId, expectedVersion, force, scope);
  }
  async getGapLock(
    gapId: string
  ): Promise<{ agentId: string; expiresAt: number; lockVersion?: number } | null> {
    return this.gaps.getGapLock(gapId);
  }

  // --- COLLABORATION OPERATIONS (Delegated) ---

  async getCollaboration(id: string, scope?: string | import('../types/memory').ContextualScope) {
    return this.collaboration.getCollaboration(id, scope);
  }
  async checkCollaborationAccess(
    id: string,
    pid: string,
    pt: ParticipantType,
    role?: CollaborationRole,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    return this.collaboration.checkCollaborationAccess(id, pid, pt, role, scope);
  }
  async closeCollaboration(
    id: string,
    aid: string,
    at: ParticipantType,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    return this.collaboration.closeCollaboration(id, aid, at, scope);
  }
  async createCollaboration(
    oid: string,
    ot: ParticipantType,
    input: import('../types/collaboration').CreateCollaborationInput,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    return this.collaboration.createCollaboration(oid, ot, input, scope);
  }
  async listCollaborationsForParticipant(
    pid: string,
    pt: ParticipantType,
    scope?: string | import('../types/index').ContextualScope
  ) {
    return this.collaboration.listCollaborationsForParticipant(pid, pt, scope);
  }

  /**
   * LEGACY: Retrieves a raw configuration JSON.
   * Delegates to the underlying persistent memory.
   */
  async getConfig(key: string): Promise<unknown> {
    const provider = this.underlying as unknown as {
      getConfig?: (key: string) => Promise<unknown>;
    };
    return provider.getConfig?.(key);
  }

  async findStaleCollaborations(
    defaultTimeoutMs: number,
    scope?: string | import('../types/index').ContextualScope
  ): Promise<import('../types/collaboration').Collaboration[]> {
    return this.underlying.findStaleCollaborations(defaultTimeoutMs, scope);
  }

  /**
   * Transits a 1:1 session into a collaboration session.
   */
  async transitToCollaboration(
    userId: string,
    scope: string | import('../types/memory').ContextualScope,
    sourceSessionId: string,
    invitedAgentIds: string[],
    name?: string
  ): Promise<import('../types/collaboration').Collaboration> {
    const collaboration = await this.underlying.transitToCollaboration(
      userId,
      scope,
      sourceSessionId,
      invitedAgentIds,
      name
    );
    return collaboration;
  }

  /**
   * Helper to derive a workspace-scoped userId for DynamoDB partition keys.
   */
  getScopedUserId(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ): string {
    return this.underlying.getScopedUserId(userId, scope);
  }

  // --- SYSTEM OPERATIONS (Delegated) ---

  async getMemoryByTypePaginated(
    t: string,
    l?: number,
    k?: Record<string, unknown>,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    return this.delegator.getMemoryByTypePaginated(t, l, k, scope);
  }
  async getMemoryByType(
    t: string,
    l?: number,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    return this.delegator.getMemoryByType(t, l, scope);
  }
  async getLowUtilizationMemory(l?: number): Promise<Record<string, unknown>[]> {
    return this.delegator.getLowUtilizationMemory(l);
  }
  async getRegisteredMemoryTypes() {
    return this.delegator.getRegisteredMemoryTypes();
  }
  async recordMemoryHit(
    u: string,
    t: number | string,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    return this.delegator.recordMemoryHit(u, t, scope);
  }
  async saveLKGHash(h: string) {
    return this.delegator.saveLKGHash(h);
  }
  async getLatestLKGHash() {
    return this.delegator.getLatestLKGHash();
  }
  async incrementRecoveryAttemptCount() {
    return this.delegator.incrementRecoveryAttemptCount();
  }
  async resetRecoveryAttemptCount() {
    return this.delegator.resetRecoveryAttemptCount();
  }
  async listByPrefix(p: string) {
    return this.delegator.listByPrefix(p);
  }

  async queryItems(params: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    return this.underlying.queryItems(params);
  }

  async putItem(
    item: Record<string, unknown>,
    params?: Partial<Record<string, unknown>>
  ): Promise<void> {
    return this.underlying.putItem(item, params as any);
  }

  async saveClarificationRequest(
    s: ClarificationState,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    return this.delegator.saveClarificationRequest(s, scope);
  }
  async getClarificationRequest(
    t: string,
    a: string,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    return this.delegator.getClarificationRequest(t, a, scope);
  }
  async updateClarificationStatus(
    t: string,
    a: string,
    status: ClarificationStatus,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    return this.delegator.updateClarificationStatus(t, a, status, scope);
  }
  async saveEscalationState(
    s: EscalationState,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    return this.delegator.saveEscalationState(s, scope);
  }
  async getEscalationState(
    t: string,
    a: string,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    return this.delegator.getEscalationState(t, a, scope);
  }
  async findExpiredClarifications(scope?: string | import('../types/memory').ContextualScope) {
    return this.delegator.findExpiredClarifications(scope);
  }
  async incrementClarificationRetry(
    t: string,
    a: string,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    return this.delegator.incrementClarificationRetry(t, a, scope);
  }

  // --- UTILS ---

  async clearHistory(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.clearHistory(userId, scope);
    MemoryCaches.conversation.delete(CacheKeys.history(userId, scope));
    MemoryCaches.conversation.delete(CacheKeys.summary(userId, scope));
  }

  getCacheStats() {
    return getCacheStatsSummary();
  }

  clearAllCaches(): void {
    MemoryCaches.userData.clear();
    MemoryCaches.conversation.clear();
    MemoryCaches.global.clear();
    MemoryCaches.search.clear();
    logger.info('All memory caches cleared');
  }

  invalidateUser(userId: string): void {
    logger.info(`Invalidating all caches for user: ${userId}`);
    MemoryCaches.userData.invalidateUser(userId);
    MemoryCaches.conversation.invalidateUser(userId);
    MemoryCaches.search.invalidatePattern(new RegExp(`(^|:)${userId}(:|$)`));
  }

  invalidateGlobalUserCaches(): void {
    MemoryCaches.global.invalidatePattern(/^gaps:/);
    MemoryCaches.search.invalidatePattern(/^insights:/);
  }
}
