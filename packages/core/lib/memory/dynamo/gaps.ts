import {
  IGapManager,
  MemoryInsight,
  GapStatus,
  GapTransitionResult,
  InsightMetadata,
  ContextualScope,
} from '../../types';
import { DynamoMemoryBase } from './base';
import { LIMITS, RETENTION } from '../../constants';
import * as GapOps from '../gap-operations';

/**
 * DynamoMemory implementation for Gap Management.
 */
export class DynamoMemoryGaps extends DynamoMemoryBase implements IGapManager {
  async getAllGaps(
    status: GapStatus = GapStatus.OPEN,
    scope?: string | ContextualScope
  ): Promise<MemoryInsight[]> {
    return GapOps.getAllGaps(this, status, scope);
  }

  async archiveStaleGaps(
    staleDays: number = LIMITS.STALE_GAP_DAYS,
    scope?: string | ContextualScope
  ): Promise<number> {
    return GapOps.archiveStaleGaps(this, staleDays, scope);
  }

  async cullResolvedGaps(
    thresholdDays: number = RETENTION.GAPS_DAYS,
    scope?: string | ContextualScope
  ): Promise<number> {
    return GapOps.cullResolvedGaps(this, thresholdDays, scope);
  }

  async setGap(
    gapId: string,
    details: string,
    metadata?: InsightMetadata,
    scope?: string | ContextualScope
  ): Promise<void> {
    return GapOps.setGap(this, gapId, details, metadata, scope);
  }

  async incrementGapAttemptCount(gapId: string, scope?: string | ContextualScope): Promise<number> {
    return GapOps.incrementGapAttemptCount(this, gapId, scope);
  }

  async updateGapStatus(
    gapId: string,
    status: GapStatus,
    scope?: string | ContextualScope,
    metadata?: Record<string, unknown>
  ): Promise<GapTransitionResult> {
    return GapOps.updateGapStatus(this, gapId, status, scope, metadata);
  }

  async acquireGapLock(
    gapId: string,
    agentId: string,
    ttlMs?: number,
    scope?: string | ContextualScope
  ): Promise<boolean> {
    return GapOps.acquireGapLock(this, gapId, agentId, ttlMs, scope);
  }

  async releaseGapLock(
    gapId: string,
    agentId: string,
    expectedVersion?: number,
    force?: boolean,
    scope?: string | ContextualScope
  ): Promise<void> {
    return GapOps.releaseGapLock(this, gapId, agentId, expectedVersion, force, scope);
  }

  async getGapLock(
    gapId: string,
    scope?: string | ContextualScope
  ): Promise<{ agentId: string; expiresAt: number; lockVersion?: number } | null> {
    return GapOps.getGapLock(this, gapId, scope);
  }

  async getGap(gapId: string, scope?: string | ContextualScope): Promise<MemoryInsight | null> {
    return GapOps.getGap(this, gapId, scope);
  }

  async updateGapMetadata(
    gapId: string,
    metadata: Partial<InsightMetadata>,
    scope?: string | ContextualScope
  ): Promise<void> {
    return GapOps.updateGapMetadata(this, gapId, metadata, scope);
  }
}
