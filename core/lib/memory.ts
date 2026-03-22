import {
  IMemory,
  Message,
  InsightMetadata,
  MemoryInsight,
  InsightCategory,
  GapStatus,
  ConversationMeta,
} from './types/index';
import { BaseMemoryProvider } from './memory/base';
import { LIMITS } from './constants';

// Import operations from submodules
import * as GapOps from './memory/gap-operations';
import * as InsightOps from './memory/insight-operations';
import * as SessionOps from './memory/session-operations';
import * as MemoryUtils from './memory/utils';
import * as ClarificationOps from './memory/clarification-operations';

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
    return SessionOps.addMessage(this, userId, message);
  }

  /**
   * Deletes a conversation session and its history
   */
  async deleteConversation(userId: string, sessionId: string): Promise<void> {
    return SessionOps.deleteConversation(this, userId, sessionId);
  }

  /**
   * Updates distilled memory with a 2-year retention policy
   */
  async updateDistilledMemory(userId: string, facts: string): Promise<void> {
    return SessionOps.updateDistilledMemory(this, userId, facts);
  }

  /**
   * Retrieves all capability gaps filtered by status
   */
  async getAllGaps(status: GapStatus = GapStatus.OPEN): Promise<MemoryInsight[]> {
    return GapOps.getAllGaps(this, status);
  }

  /**
   * Archives stale gaps that have been open for longer than the specified days.
   * Returns the number of gaps archived.
   */
  async archiveStaleGaps(staleDays: number = LIMITS.STALE_GAP_DAYS): Promise<number> {
    return GapOps.archiveStaleGaps(this, staleDays);
  }

  /**
   * Records a new capability gap
   */
  async setGap(gapId: string, details: string, metadata?: InsightMetadata): Promise<void> {
    return GapOps.setGap(this, gapId, details, metadata);
  }

  /**
   * Atomically increments the attempt counter on a capability gap and returns the new count.
   * Used by the self-healing loop to cap infinite reopen/redeploy cycles.
   */
  async incrementGapAttemptCount(gapId: string): Promise<number> {
    return GapOps.incrementGapAttemptCount(this, gapId);
  }

  /**
   * Transitions a capability gap to a new status
   */
  async updateGapStatus(gapId: string, status: GapStatus): Promise<void> {
    return GapOps.updateGapStatus(this, gapId, status);
  }

  /**
   * Adds a tactical lesson
   */
  async addLesson(userId: string, lesson: string, metadata?: InsightMetadata): Promise<void> {
    return InsightOps.addLesson(this, userId, lesson, metadata);
  }

  /**
   * Retrieves recent tactical lessons
   */
  async getLessons(userId: string): Promise<string[]> {
    return InsightOps.getLessons(this, userId);
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
    return InsightOps.addMemory(this, scopeId, category, content, metadata);
  }

  /**
   * Searches for insights across all categories
   */
  async searchInsights(
    userId?: string,
    query: string = '',
    category?: InsightCategory,
    limit: number = 50,
    lastEvaluatedKey?: Record<string, unknown>
  ): Promise<{ items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }> {
    return InsightOps.searchInsights(this, userId, query, category, limit, lastEvaluatedKey);
  }

  /**
   * Updates metadata for a specific insight
   */
  async updateInsightMetadata(
    userId: string,
    timestamp: number,
    metadata: Partial<InsightMetadata>
  ): Promise<void> {
    return InsightOps.updateInsightMetadata(this, userId, timestamp, metadata);
  }

  /**
   * Saves or updates session metadata
   */
  async saveConversationMeta(
    userId: string,
    sessionId: string,
    meta: Partial<ConversationMeta>
  ): Promise<void> {
    return SessionOps.saveConversationMeta(this, userId, sessionId, meta);
  }

  /**
   * Universal fetcher for memory items by their type using the GSI.
   */
  async getMemoryByTypePaginated(
    type: string,
    limit: number = 100,
    lastEvaluatedKey?: Record<string, unknown>
  ): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
    return MemoryUtils.getMemoryByTypePaginated(this, type, limit, lastEvaluatedKey);
  }

  /**
   * Universal fetcher for memory items by their type using the GSI.
   */
  async getMemoryByType(type: string, limit: number = 100): Promise<Record<string, unknown>[]> {
    return MemoryUtils.getMemoryByType(this, type, limit);
  }

  /**
   * Retrieves memory items with low hit counts or old lastAccessed timestamps.
   */
  async getLowUtilizationMemory(limit: number = 20): Promise<Record<string, unknown>[]> {
    return InsightOps.getLowUtilizationMemory(this, limit);
  }

  /**
   * Retrieves the list of active memory types that have been dynamically registered.
   */
  async getRegisteredMemoryTypes(): Promise<string[]> {
    return MemoryUtils.getRegisteredMemoryTypes(this);
  }

  /**
   * Atomically increments the hit count and updates the lastAccessed timestamp for a memory item.
   */
  async recordMemoryHit(userId: string, timestamp: number): Promise<void> {
    return InsightOps.recordMemoryHit(this, userId, timestamp);
  }

  /**
   * Saves the Last Known Good (LKG) commit hash after a successful health check.
   */
  async saveLKGHash(hash: string): Promise<void> {
    return SessionOps.saveLKGHash(this, hash);
  }

  /**
   * Retrieves the most recent Last Known Good (LKG) commit hash.
   */
  async getLatestLKGHash(): Promise<string | null> {
    return SessionOps.getLatestLKGHash(this);
  }

  /**
   * Atomically increments the system-wide recovery attempt count.
   */
  async incrementRecoveryAttemptCount(): Promise<number> {
    return SessionOps.incrementRecoveryAttemptCount(this);
  }

  /**
   * Resets the system-wide recovery attempt count.
   */
  async resetRecoveryAttemptCount(): Promise<void> {
    return SessionOps.resetRecoveryAttemptCount(this);
  }

  /**
   * Retrieves the latest summary for a conversation session.
   */
  async getSummary(userId: string): Promise<string | null> {
    return SessionOps.getSummary(this, userId);
  }

  /**
   * Updates the latest summary for a conversation session.
   */
  async updateSummary(userId: string, summary: string): Promise<void> {
    return SessionOps.updateSummary(this, userId, summary);
  }

  /**
   * Universal fetcher for memory items by their prefix.
   */
  async listByPrefix(prefix: string): Promise<Record<string, unknown>[]> {
    return this.scanByPrefix(prefix);
  }

  /**
   * Saves a clarification request to DynamoDB for state persistence.
   */
  async saveClarificationRequest(
    state: Omit<import('./types/memory').ClarificationState, 'type' | 'expiresAt' | 'timestamp'>
  ): Promise<void> {
    return ClarificationOps.saveClarificationRequest(this, state);
  }

  /**
   * Retrieves a clarification request by traceId and agentId.
   */
  async getClarificationRequest(
    traceId: string,
    agentId: string
  ): Promise<import('./types/memory').ClarificationState | null> {
    return ClarificationOps.getClarificationRequest(this, traceId, agentId);
  }

  /**
   * Updates the status of a clarification request.
   */
  async updateClarificationStatus(
    traceId: string,
    agentId: string,
    status: import('./types/memory').ClarificationStatus
  ): Promise<void> {
    return ClarificationOps.updateClarificationStatus(this, traceId, agentId, status);
  }

  /**
   * Finds all expired clarification requests (for orphan detection).
   */
  async findExpiredClarifications(): Promise<import('./types/memory').ClarificationState[]> {
    return ClarificationOps.findExpiredClarifications(this);
  }

  /**
   * Increments the retry count for a clarification request.
   */
  async incrementClarificationRetry(traceId: string, agentId: string): Promise<number> {
    return ClarificationOps.incrementClarificationRetry(this, traceId, agentId);
  }

  /**
   * Records a failure pattern for future cross-referencing.
   */
  async recordFailurePattern(
    scopeId: string,
    content: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number> {
    return InsightOps.recordFailurePattern(this, scopeId, content, metadata);
  }

  /**
   * Retrieves failure patterns relevant to the given context.
   */
  async getFailurePatterns(
    scopeId: string,
    context?: string,
    limit?: number
  ): Promise<MemoryInsight[]> {
    return InsightOps.getFailurePatterns(this, scopeId, context, limit);
  }
}
