import type { IMemory } from '../../types/memory';
import { logger } from '../../logger';
import { MemoryCaches, CacheKeys } from '../cache';
import { MemoryInsight, GapStatus, GapTransitionResult, InsightMetadata } from '../../types/index';

/**
 * Handles gap and plan-related memory operations for the CachedMemory provider.
 */
export class MemoryGaps {
  constructor(private readonly underlying: IMemory) {}

  /**
   * Gets all gaps with caching by status.
   */
  async getAllGaps(
    status: GapStatus = GapStatus.OPEN,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<MemoryInsight[]> {
    const cacheKey = CacheKeys.gapsByStatus(status, scope);
    const cached = MemoryCaches.global.get(cacheKey) as MemoryInsight[] | undefined;

    if (cached) {
      logger.debug(`Cache hit for gaps by status: ${status}`);
      return cached;
    }

    logger.debug(`Cache miss for gaps by status: ${status}`);
    const gaps = await this.underlying.getAllGaps(status, scope);

    // Cache gaps with 5 minute TTL
    MemoryCaches.global.set(cacheKey, gaps, 5 * 60 * 1000);

    return gaps;
  }

  /**
   * Sets a gap and invalidates cache.
   */
  async setGap(
    gapId: string,
    details: string,
    metadata?: InsightMetadata,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.setGap(gapId, details, metadata, scope);

    // Invalidate gaps cache
    MemoryCaches.global.invalidatePattern(/^gaps:/);
  }

  /**
   * Updates gap status and invalidates cache.
   */
  async updateGapStatus(
    gapId: string,
    status: GapStatus,
    scope?: string | import('../../types/memory').ContextualScope,
    metadata?: Record<string, unknown>
  ): Promise<GapTransitionResult> {
    const result = await this.underlying.updateGapStatus(gapId, status, scope, metadata);

    // Invalidate gaps cache
    MemoryCaches.global.invalidatePattern(/^gaps:/);

    return result;
  }

  async archiveStaleGaps(
    staleDays?: number,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<number> {
    const result = await this.underlying.archiveStaleGaps(staleDays, scope);
    MemoryCaches.global.invalidatePattern(/^gaps:/);
    return result;
  }

  async incrementGapAttemptCount(
    gapId: string,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<number> {
    const result = await this.underlying.incrementGapAttemptCount(gapId, scope);
    // 1.9 Invalidate gaps cache since attempt count changed
    MemoryCaches.global.invalidatePattern(/^gaps:/);
    return result;
  }

  async updateGapMetadata(
    gapId: string,
    metadata: Partial<InsightMetadata>,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.updateGapMetadata(gapId, metadata, scope);
    // Invalidate gaps cache since metadata changed
    MemoryCaches.global.invalidatePattern(/^gaps:/);
    MemoryCaches.global.delete(CacheKeys.gap(gapId, scope));
  }

  async getGap(
    gapId: string,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<MemoryInsight | null> {
    const cacheKey = CacheKeys.gap(gapId, scope);
    const cached = MemoryCaches.global.get(cacheKey) as MemoryInsight | null | undefined;

    if (cached !== undefined) {
      return cached;
    }

    const gap = await this.underlying.getGap(gapId, scope);
    MemoryCaches.global.set(cacheKey, gap, 5 * 60 * 1000);
    return gap;
  }

  async acquireGapLock(
    gapId: string,
    agentId: string,
    ttlMs?: number,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<boolean> {
    return this.underlying.acquireGapLock(gapId, agentId, ttlMs, scope);
  }

  async releaseGapLock(
    gapId: string,
    agentId: string,
    expectedVersion?: number,
    force?: boolean,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.releaseGapLock(gapId, agentId, expectedVersion, force, scope);
  }

  async getGapLock(
    gapId: string,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<{ agentId: string; expiresAt: number; lockVersion?: number } | null> {
    return this.underlying.getGapLock(gapId, scope);
  }

  /**
   * Records a failed strategic plan so the swarm learns anti-patterns.
   */
  async recordFailurePattern(
    planHash: string,
    planContent: string,
    gapIds: string[],
    failureReason: string,
    metadata?: Partial<InsightMetadata>,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<number | string> {
    const result = await this.underlying.recordFailurePattern(
      planHash,
      planContent,
      gapIds,
      failureReason,
      metadata,
      scope
    );
    return result;
  }

  /**
   * Retrieves previously failed plans to inform the planner about what NOT to do.
   */
  async getFailurePatterns(
    limit?: number,
    scope?: string | import('../../types/memory').ContextualScope
  ) {
    return this.underlying.getFailurePatterns(limit, scope);
  }
}
