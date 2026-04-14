import { DynamoMemory } from '../dynamo-memory';
import { logger } from '../../logger';
import { MemoryCaches, CacheKeys } from '../cache';
import { MemoryInsight, GapStatus, GapTransitionResult, InsightMetadata } from '../../types/index';

/**
 * Handles gap and plan-related memory operations for the CachedMemory provider.
 */
export class MemoryGaps {
  constructor(private readonly underlying: DynamoMemory) {}

  /**
   * Gets all gaps with caching by status.
   */
  async getAllGaps(
    status: GapStatus = GapStatus.OPEN,
    workspaceId?: string
  ): Promise<MemoryInsight[]> {
    const cacheKey = CacheKeys.gapsByStatus(status, workspaceId);
    const cached = MemoryCaches.global.get(cacheKey) as MemoryInsight[] | undefined;

    if (cached) {
      logger.debug(`Cache hit for gaps by status: ${status}`);
      return cached;
    }

    logger.debug(`Cache miss for gaps by status: ${status}`);
    const gaps = await this.underlying.getAllGaps(status, workspaceId);

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
    workspaceId?: string
  ): Promise<void> {
    await this.underlying.setGap(gapId, details, metadata, workspaceId);

    // Invalidate gaps cache
    MemoryCaches.global.invalidatePattern(/^gaps:/);
  }

  /**
   * Updates gap status and invalidates cache.
   */
  async updateGapStatus(
    gapId: string,
    status: GapStatus,
    workspaceId?: string
  ): Promise<GapTransitionResult> {
    const result = await this.underlying.updateGapStatus(gapId, status, workspaceId);

    // Invalidate gaps cache
    MemoryCaches.global.invalidatePattern(/^gaps:/);

    return result;
  }

  async archiveStaleGaps(staleDays?: number, workspaceId?: string): Promise<number> {
    const result = await this.underlying.archiveStaleGaps(staleDays, workspaceId);
    MemoryCaches.global.invalidatePattern(/^gaps:/);
    return result;
  }

  async incrementGapAttemptCount(gapId: string, workspaceId?: string): Promise<number> {
    const result = await this.underlying.incrementGapAttemptCount(gapId, workspaceId);
    // 1.9 Invalidate gaps cache since attempt count changed
    MemoryCaches.global.invalidatePattern(/^gaps:/);
    return result;
  }

  async updateGapMetadata(
    gapId: string,
    metadata: Partial<InsightMetadata>,
    workspaceId?: string
  ): Promise<void> {
    await this.underlying.updateGapMetadata(gapId, metadata, workspaceId);
    // Invalidate gaps cache since metadata changed
    MemoryCaches.global.invalidatePattern(/^gaps:/);
    MemoryCaches.global.delete(CacheKeys.gap(gapId, workspaceId));
  }

  async getGap(gapId: string, workspaceId?: string): Promise<MemoryInsight | null> {
    const cacheKey = CacheKeys.gap(gapId, workspaceId);
    const cached = MemoryCaches.global.get(cacheKey) as MemoryInsight | null | undefined;

    if (cached !== undefined) {
      return cached;
    }

    const gap = await this.underlying.getGap(gapId, workspaceId);
    MemoryCaches.global.set(cacheKey, gap, 5 * 60 * 1000);
    return gap;
  }

  async acquireGapLock(
    gapId: string,
    agentId: string,
    ttlMs?: number,
    workspaceId?: string
  ): Promise<boolean> {
    return this.underlying.acquireGapLock(gapId, agentId, ttlMs, workspaceId);
  }

  async releaseGapLock(
    gapId: string,
    agentId: string,
    expectedVersion?: number,
    force?: boolean,
    workspaceId?: string
  ): Promise<void> {
    await this.underlying.releaseGapLock(gapId, agentId, expectedVersion, force, workspaceId);
  }

  async getGapLock(
    gapId: string,
    workspaceId?: string
  ): Promise<{ agentId: string; expiresAt: number; lockVersion?: number } | null> {
    return this.underlying.getGapLock(gapId, workspaceId);
  }

  async recordFailedPlan(
    planHash: string,
    planContent: string,
    gapIds: string[],
    failureReason: string,
    metadata?: Partial<InsightMetadata>,
    workspaceId?: string
  ): Promise<number | string> {
    const result = await this.underlying.recordFailedPlan(
      planHash,
      planContent,
      gapIds,
      failureReason,
      metadata,
      workspaceId
    );
    MemoryCaches.search.invalidatePattern(/^insights:/);
    return result;
  }

  async getFailedPlans(limit?: number, workspaceId?: string): Promise<MemoryInsight[]> {
    return this.underlying.getFailedPlans(limit, workspaceId);
  }
}
