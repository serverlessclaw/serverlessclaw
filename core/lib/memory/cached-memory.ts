/**
 * @module CachedMemory
 * @description Wrapper for DynamoMemory that adds LRU caching for frequently accessed items.
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
import type { CollaborationRole, ParticipantType } from '../types/collaboration';
import { DynamoMemory } from '../memory';
import { MemoryCaches, CacheKeys, getCacheStatsSummary } from './cache';
import { logger } from '../logger';

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

  async getHistory(userId: string, workspaceId?: string): Promise<Message[]> {
    const cacheKey = CacheKeys.history(userId, workspaceId);
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
    const promise = this.underlying.getHistory(userId, workspaceId).finally(() => {
      this.historyPromises.delete(cacheKey);
    });

    this.historyPromises.set(cacheKey, promise);
    const history = await promise;
    MemoryCaches.conversation.set(cacheKey, history, 2 * 60 * 1000);
    return history;
  }

  async addMessage(userId: string, message: Message, workspaceId?: string): Promise<void> {
    await this.underlying.addMessage(userId, message, workspaceId);
    MemoryCaches.conversation.delete(CacheKeys.history(userId, workspaceId));
    MemoryCaches.conversation.delete(CacheKeys.summary(userId, workspaceId));
  }

  async getSummary(userId: string, workspaceId?: string): Promise<string | null> {
    const cacheKey = CacheKeys.summary(userId, workspaceId);
    const cached = MemoryCaches.conversation.get(cacheKey) as string | null | undefined;

    if (cached !== undefined) {
      logger.debug(`Cache hit for summary: ${userId}`);
      return cached;
    }

    const summary = await this.underlying.getSummary(userId, workspaceId);
    MemoryCaches.conversation.set(cacheKey, summary, 2 * 60 * 1000);
    return summary;
  }

  async updateSummary(userId: string, summary: string, workspaceId?: string): Promise<void> {
    await this.underlying.updateSummary(userId, summary, workspaceId);
    MemoryCaches.conversation.delete(CacheKeys.summary(userId, workspaceId));
  }

  async listConversations(userId: string, workspaceId?: string): Promise<ConversationMeta[]> {
    return this.underlying.listConversations(userId, workspaceId);
  }

  async deleteConversation(userId: string, sessionId: string, workspaceId?: string): Promise<void> {
    await this.underlying.deleteConversation(userId, sessionId, workspaceId);
    MemoryCaches.conversation.delete(CacheKeys.history(userId, workspaceId));
  }

  async saveConversationMeta(
    userId: string,
    sessionId: string,
    meta: Partial<ConversationMeta>,
    workspaceId?: string
  ): Promise<void> {
    await this.underlying.saveConversationMeta(userId, sessionId, meta, workspaceId);
    MemoryCaches.conversation.delete(CacheKeys.history(userId, workspaceId));
    MemoryCaches.conversation.delete(CacheKeys.summary(userId, workspaceId));
  }

  // --- USER DATA & INSIGHTS ---

  async getDistilledMemory(userId: string, workspaceId?: string): Promise<string> {
    const cacheKey = CacheKeys.distilledMemory(userId, workspaceId);
    const cached = MemoryCaches.userData.get(cacheKey) as string | undefined;

    if (cached !== undefined) return cached;

    const distilled = await this.underlying.getDistilledMemory(userId, workspaceId);
    MemoryCaches.userData.set(cacheKey, distilled, 5 * 60 * 1000);
    return distilled;
  }

  async updateDistilledMemory(userId: string, facts: string, workspaceId?: string): Promise<void> {
    await this.underlying.updateDistilledMemory(userId, facts, workspaceId);
    MemoryCaches.userData.delete(CacheKeys.distilledMemory(userId, workspaceId));
  }

  async getLessons(userId: string, workspaceId?: string): Promise<string[]> {
    const cacheKey = CacheKeys.lessons(userId, workspaceId);
    const cached = MemoryCaches.userData.get(cacheKey) as string[] | undefined;

    if (cached) return cached;

    const lessons = await this.underlying.getLessons(userId, workspaceId);
    MemoryCaches.userData.set(cacheKey, lessons, 5 * 60 * 1000);
    return lessons;
  }

  async addLesson(
    userId: string,
    lesson: string,
    metadata?: Partial<InsightMetadata> & { tags?: string[] },
    workspaceId?: string
  ): Promise<void> {
    await this.underlying.addLesson(userId, lesson, metadata as InsightMetadata, workspaceId);
    MemoryCaches.userData.delete(CacheKeys.lessons(userId, workspaceId));
  }

  async getGlobalLessons(limit?: number): Promise<string[]> {
    const effectiveLimit = limit ?? 5;
    const cacheKey = CacheKeys.globalLessons(effectiveLimit);
    const cached = MemoryCaches.global.get(cacheKey) as string[] | undefined;

    if (cached) return cached;

    const lessons = await this.underlying.getGlobalLessons(effectiveLimit);
    MemoryCaches.global.set(cacheKey, lessons, 15 * 60 * 1000);
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
    userId?: string,
    query: string = '',
    category?: InsightCategory,
    limit: number = 50,
    lastEvaluatedKey?: Record<string, unknown>,
    tags?: string[],
    orgId?: string,
    workspaceId?: string
  ): Promise<{ items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }> {
    if (lastEvaluatedKey) {
      return this.underlying.searchInsights(
        userId,
        query,
        category,
        limit,
        lastEvaluatedKey,
        tags,
        orgId,
        workspaceId
      );
    }

    const cacheKey = CacheKeys.insightsSearch(
      userId ?? 'global',
      query,
      category,
      tags,
      orgId,
      workspaceId
    );
    const cached = MemoryCaches.search.get(cacheKey) as
      | { items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }
      | undefined;
    if (cached) return cached;

    const result = await this.underlying.searchInsights(
      userId,
      query,
      category,
      limit,
      undefined,
      tags,
      orgId,
      workspaceId
    );
    MemoryCaches.search.set(cacheKey, result, 3 * 60 * 1000);
    return result;
  }

  async addMemory(
    scopeId: string,
    category: InsightCategory | string,
    content: string,
    metadata?: Partial<InsightMetadata> & { orgId?: string; tags?: string[] },
    workspaceId?: string
  ): Promise<number | string> {
    const result = await this.underlying.addMemory(
      scopeId,
      category,
      content,
      metadata,
      workspaceId
    );
    MemoryCaches.search.invalidatePattern(new RegExp(`^insights:${scopeId}:`));
    return result;
  }

  async recordFailurePattern(
    scopeId: string,
    content: string,
    metadata?: Partial<InsightMetadata>,
    workspaceId?: string
  ): Promise<number | string> {
    const result = await this.underlying.recordFailurePattern(
      scopeId,
      content,
      metadata,
      workspaceId
    );
    MemoryCaches.search.invalidatePattern(/^insights:/);
    return result;
  }

  async getFailurePatterns(
    scopeId: string,
    context?: string,
    limit?: number,
    workspaceId?: string
  ): Promise<MemoryInsight[]> {
    return this.underlying.getFailurePatterns(scopeId, context, limit, workspaceId);
  }

  async searchInsightsForPreferences(
    userId: string,
    workspaceId?: string
  ): Promise<{ prefixed: MemoryInsight[]; raw: MemoryInsight[] }> {
    const prefixedKey = `${userId}-prefixed${workspaceId ? `-${workspaceId}` : ''}`;
    const rawKey = `${userId}-raw${workspaceId ? `-${workspaceId}` : ''}`;

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
        workspaceId
      ),
      this.underlying.searchInsights(
        userId,
        '*',
        InsightCategory.USER_PREFERENCE,
        50,
        undefined,
        undefined,
        undefined,
        workspaceId
      ),
    ]);

    MemoryCaches.userData.set(prefixedKey, prefixed.items, 5 * 60 * 1000);
    MemoryCaches.userData.set(rawKey, raw.items, 5 * 60 * 1000);
    return { prefixed: prefixed.items, raw: raw.items };
  }

  async updateInsightMetadata(
    userId: string,
    timestamp: number | string,
    metadata: Partial<InsightMetadata>,
    workspaceId?: string
  ): Promise<void> {
    await this.underlying.updateInsightMetadata(userId, timestamp, metadata, workspaceId);
    MemoryCaches.search.invalidatePattern(new RegExp(`^insights:${userId}:`));
  }

  async refineMemory(
    userId: string,
    timestamp: number | string,
    content?: string,
    metadata?: Partial<InsightMetadata> & { tags?: string[] },
    workspaceId?: string
  ): Promise<void> {
    await this.underlying.refineMemory(userId, timestamp, content, metadata, workspaceId);
    MemoryCaches.search.invalidatePattern(new RegExp(`^insights:${userId}:`));
    if (metadata?.category)
      MemoryCaches.search.invalidatePattern(new RegExp(`:${metadata.category}`));
  }

  // --- GAP & PLAN OPERATIONS (Delegated) ---

  async getAllGaps(status: GapStatus = GapStatus.OPEN, workspaceId?: string) {
    return this.gaps.getAllGaps(status, workspaceId);
  }
  async setGap(gapId: string, details: string, metadata?: InsightMetadata, workspaceId?: string) {
    return this.gaps.setGap(gapId, details, metadata, workspaceId);
  }
  async updateGapStatus(gapId: string, status: GapStatus, workspaceId?: string) {
    return this.gaps.updateGapStatus(gapId, status, workspaceId);
  }
  async archiveStaleGaps(staleDays?: number, workspaceId?: string) {
    return this.gaps.archiveStaleGaps(staleDays, workspaceId);
  }
  async incrementGapAttemptCount(gapId: string, workspaceId?: string) {
    return this.gaps.incrementGapAttemptCount(gapId, workspaceId);
  }
  async updateGapMetadata(gapId: string, metadata: Partial<InsightMetadata>, workspaceId?: string) {
    return this.gaps.updateGapMetadata(gapId, metadata, workspaceId);
  }
  async getGap(gapId: string, workspaceId?: string) {
    return this.gaps.getGap(gapId, workspaceId);
  }
  async acquireGapLock(gapId: string, agentId: string, ttlMs?: number, workspaceId?: string) {
    return this.gaps.acquireGapLock(gapId, agentId, ttlMs, workspaceId);
  }
  async releaseGapLock(
    gapId: string,
    agentId: string,
    expectedVersion?: number,
    force?: boolean,
    workspaceId?: string
  ) {
    return this.gaps.releaseGapLock(gapId, agentId, expectedVersion, force, workspaceId);
  }
  async getGapLock(gapId: string, workspaceId?: string) {
    return this.gaps.getGapLock(gapId, workspaceId);
  }
  async recordFailedPlan(
    planHash: string,
    planContent: string,
    gapIds: string[],
    failureReason: string,
    metadata?: Partial<InsightMetadata>,
    workspaceId?: string
  ) {
    return this.gaps.recordFailedPlan(
      planHash,
      planContent,
      gapIds,
      failureReason,
      metadata,
      workspaceId
    );
  }
  async getFailedPlans(limit?: number, workspaceId?: string) {
    return this.gaps.getFailedPlans(limit, workspaceId);
  }

  // --- COLLABORATION OPERATIONS (Delegated) ---

  async getCollaboration(id: string, wid?: string) {
    return this.collaboration.getCollaboration(id, wid);
  }
  async checkCollaborationAccess(
    id: string,
    pid: string,
    pt: ParticipantType,
    role?: CollaborationRole,
    wid?: string
  ) {
    return this.collaboration.checkCollaborationAccess(id, pid, pt, role, wid);
  }
  async closeCollaboration(id: string, aid: string, at: ParticipantType, wid?: string) {
    return this.collaboration.closeCollaboration(id, aid, at, wid);
  }
  async createCollaboration(
    oid: string,
    ot: ParticipantType,
    input: import('../types/collaboration').CreateCollaborationInput,
    wid?: string
  ) {
    return this.collaboration.createCollaboration(oid, ot, input, wid);
  }
  async listCollaborationsForParticipant(pid: string, pt: ParticipantType, wid?: string) {
    return this.collaboration.listCollaborationsForParticipant(pid, pt, wid);
  }

  // --- SYSTEM OPERATIONS (Delegated) ---

  async getMemoryByTypePaginated(t: string, l?: number, k?: Record<string, unknown>, wid?: string) {
    return this.delegator.getMemoryByTypePaginated(t, l, k, wid);
  }
  async getMemoryByType(t: string, l?: number, wid?: string) {
    return this.delegator.getMemoryByType(t, l, wid);
  }
  async getLowUtilizationMemory(l?: number) {
    return this.delegator.getLowUtilizationMemory(l);
  }
  async getRegisteredMemoryTypes() {
    return this.delegator.getRegisteredMemoryTypes();
  }
  async recordMemoryHit(u: string, t: number | string, wid?: string) {
    return this.delegator.recordMemoryHit(u, t, wid);
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
  async saveClarificationRequest(s: any, wid?: string) {
    return this.delegator.saveClarificationRequest(s, wid);
  }
  async getClarificationRequest(t: string, a: string, wid?: string) {
    return this.delegator.getClarificationRequest(t, a, wid);
  }
  async updateClarificationStatus(t: string, a: string, s: any, wid?: string) {
    return this.delegator.updateClarificationStatus(t, a, s, wid);
  }
  async saveEscalationState(s: any, wid?: string) {
    return this.delegator.saveEscalationState(s, wid);
  }
  async getEscalationState(t: string, a: string, wid?: string) {
    return this.delegator.getEscalationState(t, a, wid);
  }
  async findExpiredClarifications(wid?: string) {
    return this.delegator.findExpiredClarifications(wid);
  }
  async incrementClarificationRetry(t: string, a: string, wid?: string) {
    return this.delegator.incrementClarificationRetry(t, a, wid);
  }

  // --- UTILS ---

  async clearHistory(userId: string, workspaceId?: string): Promise<void> {
    await this.underlying.clearHistory(userId, workspaceId);
    MemoryCaches.conversation.delete(CacheKeys.history(userId, workspaceId));
    MemoryCaches.conversation.delete(CacheKeys.summary(userId, workspaceId));
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
