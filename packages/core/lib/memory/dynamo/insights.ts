import {
  IKnowledgeStore,
  InsightMetadata,
  MemoryInsight,
  InsightCategory,
  ContextualScope,
} from '../../types';
import { DynamoMemoryGaps } from './gaps';
import * as InsightOps from '../insight-operations';
import { getDistilledMemory } from '../base-operations';
import { updateDistilledMemory } from '../session-operations';

/**
 * DynamoMemory implementation for Knowledge and Insight operations.
 */
export class DynamoMemoryInsights extends DynamoMemoryGaps implements IKnowledgeStore {
  async getDistilledMemory(userId: string, scope?: string | ContextualScope): Promise<string> {
    return getDistilledMemory(this, userId, scope);
  }

  async updateDistilledMemory(
    userId: string,
    facts: string,
    scope?: string | ContextualScope
  ): Promise<void> {
    return updateDistilledMemory(this, userId, facts, scope);
  }

  async addLesson(
    userId: string,
    lesson: string,
    metadata?: Partial<InsightMetadata> & { tags?: string[] },
    scope?: string | ContextualScope
  ): Promise<void> {
    const { AgentRegistry } = await import('../../registry');
    const days = await AgentRegistry.getRetentionDays('LESSONS_DAYS');
    const expiresAt = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;

    return InsightOps.addLesson(
      this,
      userId,
      lesson,
      { ...metadata, expiresAt } as InsightMetadata,
      scope
    );
  }

  async getLessons(userId: string, scope?: string | ContextualScope): Promise<string[]> {
    return InsightOps.getLessons(this, userId, scope);
  }

  async addMemory(
    scopeId: string,
    category: InsightCategory | string,
    content: string,
    metadata?: Partial<InsightMetadata> & { orgId?: string; tags?: string[] },
    scope?: string | ContextualScope
  ): Promise<number | string> {
    return InsightOps.addMemory(this, scopeId, category, content, metadata, scope);
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
    return InsightOps.searchInsights(
      this,
      queryOrUserId,
      queryText,
      category,
      limit,
      lastEvaluatedKey,
      tags,
      orgId,
      scope
    );
  }

  async recordFailurePattern(
    planHash: string,
    planContent: string,
    gapIds: string[],
    failureReason: string,
    metadata?: Partial<InsightMetadata>,
    scope?: string | ContextualScope
  ): Promise<number | string> {
    return InsightOps.recordFailurePattern(
      this,
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
    scope?: string | ContextualScope
  ): Promise<MemoryInsight[]> {
    return InsightOps.getFailurePatterns(this, limit, scope);
  }

  async addGlobalLesson(
    lesson: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number | string> {
    return InsightOps.addGlobalLesson(this, lesson, metadata);
  }

  async getGlobalLessons(limit?: number): Promise<string[]> {
    return InsightOps.getGlobalLessons(this, limit);
  }

  async refineMemory(
    userId: string,
    timestamp: number | string,
    content?: string,
    metadata?: Partial<InsightMetadata> & { tags?: string[] },
    scope?: string | ContextualScope
  ): Promise<void> {
    return InsightOps.refineMemory(this, userId, timestamp, content, metadata, scope);
  }

  async updateInsightMetadata(
    userId: string,
    timestamp: number | string,
    metadata: Partial<InsightMetadata>,
    scope?: string | ContextualScope
  ): Promise<void> {
    return InsightOps.updateInsightMetadata(this, userId, timestamp, metadata, scope);
  }

  async getLowUtilizationMemory(limit?: number): Promise<Record<string, unknown>[]> {
    return InsightOps.getLowUtilizationMemory(this, limit);
  }

  async recordMemoryHit(
    userId: string,
    timestamp: number | string,
    scope?: string | ContextualScope
  ): Promise<void> {
    return InsightOps.recordMemoryHit(this, userId, timestamp, scope);
  }

  async saveDistilledRecoveryLog(
    traceId: string,
    task: string,
    scope?: string | ContextualScope
  ): Promise<void> {
    await this.addMemory(
      `RECOVERY#${traceId}`,
      InsightCategory.FAILURE_PATTERN,
      task,
      {
        type: 'RECOVERY_LOG',
        traceId,
      } as any,
      scope
    );
  }
}
