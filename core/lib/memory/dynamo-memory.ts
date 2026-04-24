import {
  IMemory,
  Message,
  InsightMetadata,
  MemoryInsight,
  InsightCategory,
  GapStatus,
  GapTransitionResult,
  ConversationMeta,
  ClarificationState,
  ClarificationStatus,
  ContextualScope,
} from '../types/index';
import { BaseMemoryProvider } from './base';
import { logger } from '../logger';
import { LIMITS, RETENTION } from '../constants';
export { CachedMemory } from './cached-memory';

// Import operations from submodules
import * as GapOps from './gap-operations';
import * as InsightOps from './insight-operations';
import * as SessionOps from './session-operations';
import * as MemoryUtils from './utils';
import * as ClarificationOps from './clarification-operations';
import * as CollaborationOps from './collaboration-operations';
import * as BaseOps from './base-operations';

/**
 * Implementation of IMemory using AWS DynamoDB for persistent storage
 * with a tiered retention strategy.
 */
export class DynamoMemory extends BaseMemoryProvider implements IMemory {
  /**
   * Appends a new message with tiered retention.
   */
  async addMessage(
    userId: string,
    message: Message,
    scope?: string | ContextualScope
  ): Promise<void> {
    return SessionOps.addMessage(this, userId, message, scope);
  }

  /**
   * Retrieves the conversation history for a specific user or session.
   */
  async getHistory(userId: string, scope?: string | ContextualScope): Promise<Message[]> {
    return BaseOps.getHistory(this, userId, scope);
  }

  /**
   * Clears the conversation history for a specific user or session.
   */
  async clearHistory(userId: string, scope?: string | ContextualScope): Promise<void> {
    return BaseOps.clearHistory(this, userId, scope);
  }

  /**
   * Deletes a conversation session and its history
   */
  async deleteConversation(
    userId: string,
    sessionId: string,
    scope?: string | ContextualScope
  ): Promise<void> {
    return SessionOps.deleteConversation(this, userId, sessionId, scope);
  }

  /**
   * Updates distilled memory with a 2-year retention policy
   */
  async updateDistilledMemory(
    userId: string,
    facts: string,
    scope?: string | ContextualScope
  ): Promise<void> {
    return SessionOps.updateDistilledMemory(this, userId, facts, scope);
  }

  /**
   * Retrieves the distilled "long-term" memory facts for a user.
   */
  async getDistilledMemory(userId: string, scope?: string | ContextualScope): Promise<string> {
    return BaseOps.getDistilledMemory(this, userId, scope);
  }

  /**
   * Retrieves all capability gaps filtered by status
   */
  async getAllGaps(
    status: GapStatus = GapStatus.OPEN,
    scope?: string | ContextualScope
  ): Promise<MemoryInsight[]> {
    return GapOps.getAllGaps(this, status, scope);
  }

  /**
   * Archives stale gaps that have been open for longer than the specified days.
   */
  async archiveStaleGaps(
    staleDays: number = LIMITS.STALE_GAP_DAYS,
    scope?: string | ContextualScope
  ): Promise<number> {
    return GapOps.archiveStaleGaps(this, staleDays, scope);
  }

  /**
   * Culls resolved gaps older than retention threshold.
   */
  async cullResolvedGaps(
    thresholdDays: number = RETENTION.GAPS_DAYS,
    scope?: string | ContextualScope
  ): Promise<number> {
    return GapOps.cullResolvedGaps(this, thresholdDays, scope);
  }

  /**
   * Records a new capability gap
   */
  async setGap(
    gapId: string,
    details: string,
    metadata?: InsightMetadata,
    scope?: string | ContextualScope
  ): Promise<void> {
    return GapOps.setGap(this, gapId, details, metadata, scope);
  }

  /**
   * Atomically increments the attempt counter on a capability gap.
   */
  async incrementGapAttemptCount(gapId: string, scope?: string | ContextualScope): Promise<number> {
    return GapOps.incrementGapAttemptCount(this, gapId, scope);
  }

  /**
   * Transitions a capability gap to a new status
   */
  async updateGapStatus(
    gapId: string,
    status: GapStatus,
    scope?: string | ContextualScope,
    metadata?: Record<string, unknown>
  ): Promise<GapTransitionResult> {
    return GapOps.updateGapStatus(this, gapId, status, scope, metadata);
  }

  /**
   * Adds a tactical lesson
   */
  async addLesson(
    userId: string,
    lesson: string,
    metadata?: Partial<InsightMetadata> & { tags?: string[] },
    scope?: string | ContextualScope
  ): Promise<void> {
    const { AgentRegistry } = await import('../registry');
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

  /**
   * Retrieves recent tactical lessons
   */
  async getLessons(userId: string, scope?: string | ContextualScope): Promise<string[]> {
    return InsightOps.getLessons(this, userId, scope);
  }

  /**
   * Adds a new granular memory item into the user or global scope.
   */
  async addMemory(
    scopeId: string,
    category: InsightCategory | string,
    content: string,
    metadata?: Partial<InsightMetadata> & { orgId?: string; tags?: string[] },
    scope?: string | ContextualScope
  ): Promise<number | string> {
    return InsightOps.addMemory(this, scopeId, category, content, metadata, scope);
  }

  /**
   * Omni-Signature search implementation.
   */
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

  /**
   * Records a recurring failure pattern for future cross-referencing.
   */
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

  /**
   * Retrieves failure patterns relevant to the given context.
   */
  async getFailurePatterns(
    limit?: number,
    scope?: string | ContextualScope
  ): Promise<MemoryInsight[]> {
    return InsightOps.getFailurePatterns(this, limit, scope);
  }

  /**
   * Adds a system-wide lesson that benefits ALL users and sessions.
   */
  async addGlobalLesson(
    lesson: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number | string> {
    return InsightOps.addGlobalLesson(this, lesson, metadata);
  }

  /**
   * Retrieves system-wide lessons for injection into agent prompts.
   */
  async getGlobalLessons(limit?: number): Promise<string[]> {
    return InsightOps.getGlobalLessons(this, limit);
  }

  /**
   * Updates metadata for a specific insight
   */
  async updateInsightMetadata(
    userId: string,
    timestamp: number | string,
    metadata: Partial<InsightMetadata>,
    scope?: string | ContextualScope
  ): Promise<void> {
    return InsightOps.refineMemory(this, userId, timestamp, undefined, metadata, scope);
  }

  /**
   * Refines an existing memory item by updating its content or metadata.
   */
  async refineMemory(
    userId: string,
    timestamp: number | string,
    content?: string,
    metadata?: Partial<InsightMetadata> & { tags?: string[] },
    scope?: string | ContextualScope
  ): Promise<void> {
    return InsightOps.refineMemory(this, userId, timestamp, content, metadata, scope);
  }

  /**
   * Saves a distilled recovery log for emergency rollback context.
   */
  async saveDistilledRecoveryLog(traceId: string, task: string): Promise<void> {
    await this.addMemory(`RECOVERY#${traceId}`, InsightCategory.FAILURE_PATTERN, task, {
      type: 'RECOVERY_LOG',
      traceId,
    });
  }

  /**
   * Saves or updates session metadata
   */
  async saveConversationMeta(
    userId: string,
    sessionId: string,
    meta: Partial<ConversationMeta>,
    scope?: string | ContextualScope
  ): Promise<void> {
    return SessionOps.saveConversationMeta(this, userId, sessionId, meta, scope);
  }

  /**
   * Lists all available conversation sessions for a user.
   */
  async listConversations(
    userId: string,
    scope?: string | ContextualScope
  ): Promise<ConversationMeta[]> {
    return BaseOps.listConversations(this, userId, scope);
  }

  /**
   * Universal fetcher for memory items by their type using the GSI.
   */
  async getMemoryByTypePaginated(
    type: string,
    limit: number = 100,
    lastEvaluatedKey?: Record<string, unknown>,
    scope?: string | ContextualScope
  ): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
    return MemoryUtils.getMemoryByTypePaginated(this, type, limit, lastEvaluatedKey, scope);
  }

  /**
   * Universal fetcher for memory items by their type using the GSI.
   */
  async getMemoryByType(
    type: string,
    limit: number = 100,
    scope?: string | ContextualScope
  ): Promise<Record<string, unknown>[]> {
    const { items } = await MemoryUtils.getMemoryByTypePaginated(
      this,
      type,
      limit,
      undefined,
      scope
    );
    return items;
  }

  /**
   * Retrieves memory items with low utilization for metabolic analysis.
   */
  async getLowUtilizationMemory(limit?: number): Promise<Record<string, unknown>[]> {
    return InsightOps.getLowUtilizationMemory(this, limit);
  }

  /**
   * Retrieves the list of active memory types that have been dynamically registered.
   */
  async getRegisteredMemoryTypes(): Promise<string[]> {
    return MemoryUtils.getRegisteredMemoryTypes(this);
  }

  /**
   * Atomically increments hit count and updates lastAccessed timestamp.
   */
  async recordMemoryHit(
    userId: string,
    timestamp: number | string,
    scope?: string | ContextualScope
  ): Promise<void> {
    return InsightOps.recordMemoryHit(this, userId, timestamp, scope);
  }

  /**
   * Saves the Last Known Good (LKG) commit hash.
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
   * Universal fetcher for memory items by their prefix.
   */
  async listByPrefix(prefix: string): Promise<Record<string, unknown>[]> {
    return this.scanByPrefix(prefix);
  }

  /**
   * Saves a clarification request to DynamoDB for state persistence.
   */
  async saveClarificationRequest(
    state: Omit<ClarificationState, 'type' | 'expiresAt' | 'timestamp'>,
    scope?: string | ContextualScope
  ): Promise<void> {
    return ClarificationOps.saveClarificationRequest(this, state, scope);
  }

  /**
   * Retrieves a clarification request by traceId and agentId.
   */
  async getClarificationRequest(
    traceId: string,
    agentId: string,
    scope?: string | ContextualScope
  ): Promise<ClarificationState | null> {
    return ClarificationOps.getClarificationRequest(this, traceId, agentId, scope);
  }

  /**
   * Updates the status of a clarification request.
   */
  async updateClarificationStatus(
    traceId: string,
    agentId: string,
    status: ClarificationStatus,
    scope?: string | ContextualScope
  ): Promise<void> {
    return ClarificationOps.updateClarificationStatus(this, traceId, agentId, status, scope);
  }

  /**
   * Saves escalation state for a clarification.
   */
  async saveEscalationState(
    state: import('../types/escalation').EscalationState,
    scope?: string | ContextualScope
  ): Promise<void> {
    return ClarificationOps.saveEscalationState(this, state, scope);
  }

  /**
   * Retrieves escalation state for a clarification.
   */
  async getEscalationState(
    traceId: string,
    agentId: string,
    scope?: string | ContextualScope
  ): Promise<import('../types/escalation').EscalationState | null> {
    return ClarificationOps.getEscalationState(this, traceId, agentId, scope);
  }

  /**
   * Finds all expired clarification requests (for orphan detection).
   */
  async findExpiredClarifications(scope?: string | ContextualScope): Promise<ClarificationState[]> {
    return ClarificationOps.findExpiredClarifications(this, scope);
  }

  /**
   * Increments the retry count for a clarification request.
   */
  async incrementClarificationRetry(
    traceId: string,
    agentId: string,
    scope?: string | ContextualScope
  ): Promise<number> {
    return ClarificationOps.incrementClarificationRetry(this, traceId, agentId, scope);
  }

  /**
   * Acquires a lock on a gap.
   */
  async acquireGapLock(
    gapId: string,
    agentId: string,
    ttlMs?: number,
    scope?: string | ContextualScope
  ): Promise<boolean> {
    return GapOps.acquireGapLock(this, gapId, agentId, ttlMs, scope);
  }

  /**
   * Releases a gap lock.
   */
  async releaseGapLock(
    gapId: string,
    agentId: string,
    expectedVersion?: number,
    force?: boolean,
    scope?: string | ContextualScope
  ): Promise<void> {
    return GapOps.releaseGapLock(this, gapId, agentId, expectedVersion, force, scope);
  }

  /**
   * Checks if a gap is currently locked and returns the lock holder info.
   */
  async getGapLock(
    gapId: string,
    scope?: string | ContextualScope
  ): Promise<{ agentId: string; expiresAt: number; lockVersion?: number } | null> {
    return GapOps.getGapLock(this, gapId, scope);
  }

  /**
   * Retrieves a specific capability gap by its ID.
   */
  async getGap(gapId: string, scope?: string | ContextualScope): Promise<MemoryInsight | null> {
    return GapOps.getGap(this, gapId, scope);
  }

  /**
   * Updates metadata fields on a specific gap.
   */
  async updateGapMetadata(
    gapId: string,
    metadata: Partial<InsightMetadata>,
    scope?: string | ContextualScope
  ): Promise<void> {
    return GapOps.updateGapMetadata(this, gapId, metadata, scope);
  }

  // Collaboration Operations

  /**
   * Creates a new collaboration with a shared session.
   */
  async createCollaboration(
    ownerId: string,
    ownerType: import('../types/collaboration').ParticipantType,
    input: import('../types/collaboration').CreateCollaborationInput,
    scope?: string | ContextualScope
  ): Promise<import('../types/collaboration').Collaboration> {
    return CollaborationOps.createCollaboration(this, ownerId, ownerType, input, scope);
  }

  /**
   * Gets a collaboration by ID.
   */
  async getCollaboration(
    collaborationId: string,
    scope?: string | ContextualScope
  ): Promise<import('../types/collaboration').Collaboration | null> {
    return CollaborationOps.getCollaboration(this, collaborationId, scope);
  }

  /**
   * Adds a participant to a collaboration.
   */
  async addCollaborationParticipant(
    collaborationId: string,
    actorId: string,
    actorType: import('../types/collaboration').ParticipantType,
    newParticipant: {
      type: import('../types/collaboration').ParticipantType;
      id: string;
      role: import('../types/collaboration').CollaborationRole;
    },
    scope?: string | ContextualScope
  ): Promise<void> {
    return CollaborationOps.addCollaborationParticipant(
      this,
      collaborationId,
      actorId,
      actorType,
      newParticipant,
      scope
    );
  }

  /**
   * Lists collaborations for a participant.
   */
  async listCollaborationsForParticipant(
    participantId: string,
    participantType: import('../types/collaboration').ParticipantType,
    scope?: string | ContextualScope
  ): Promise<
    Array<{
      collaborationId: string;
      role: import('../types/collaboration').CollaborationRole;
      collaborationName: string;
    }>
  > {
    return CollaborationOps.listCollaborationsForParticipant(
      this,
      participantId,
      participantType,
      scope
    );
  }

  /**
   * Finds collaborations that have timed out.
   */
  async findStaleCollaborations(
    defaultTimeoutMs: number,
    scope?: string | ContextualScope
  ): Promise<import('../types/collaboration').Collaboration[]> {
    return CollaborationOps.findStaleCollaborations(this, defaultTimeoutMs, scope);
  }

  /**
   * Checks if a participant has access to a collaboration.
   */
  async checkCollaborationAccess(
    collaborationId: string,
    participantId: string,
    participantType: import('../types/collaboration').ParticipantType,
    requiredRole?: import('../types/collaboration').CollaborationRole,
    scope?: string | ContextualScope
  ): Promise<boolean> {
    return CollaborationOps.checkCollaborationAccess(
      this,
      collaborationId,
      participantId,
      participantType,
      requiredRole,
      scope
    );
  }

  /**
   * Closes a collaboration.
   */
  async closeCollaboration(
    collaborationId: string,
    actorId: string,
    actorType: import('../types/collaboration').ParticipantType,
    scope?: string | ContextualScope
  ): Promise<void> {
    return CollaborationOps.closeCollaboration(this, collaborationId, actorId, actorType, scope);
  }

  /**
   * Transits a 1:1 session into a collaboration session
   */
  async transitToCollaboration(
    userId: string,
    scope: string | ContextualScope,
    sourceSessionId: string,
    invitedAgentIds: string[],
    name?: string
  ): Promise<import('../types/collaboration').Collaboration> {
    return CollaborationOps.transitToCollaboration(
      this,
      userId,
      scope,
      sourceSessionId,
      invitedAgentIds,
      name
    );
  }

  /**
   * LEGACY: Retrieves a raw configuration JSON from the memory table.
   * This is used by the dashboard for global stats and budgets.
   * TODO: Migrate to ConfigManager.
   */
  async getConfig(key: string): Promise<Record<string, unknown> | undefined> {
    logger.debug(`[DynamoMemory] LEGACY getConfig: ${key}`);
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { userId: key, timestamp: 0 },
      })
    );
    return response.Item as Record<string, unknown> | undefined;
  }

  /**
   * Helper to derive a workspace-scoped userId for DynamoDB partition keys.
   */

  /**
   * Retrieves the latest summary for a conversation session.
   */
  async getSummary(userId: string, scope?: string | ContextualScope): Promise<string | null> {
    return SessionOps.getSummary(this, userId, scope);
  }

  /**
   * Updates the latest summary for a conversation session.
   */
  async updateSummary(
    userId: string,
    summary: string,
    scope?: string | ContextualScope
  ): Promise<void> {
    return SessionOps.updateSummary(this, userId, summary, scope);
  }

  /**
   * Gets cache statistics for monitoring.
   */
  getCacheStats() {
    return {
      userData: { hits: 0, misses: 0, evictions: 0, size: 0 },
      conversation: { hits: 0, misses: 0, evictions: 0, size: 0 },
      global: { hits: 0, misses: 0, evictions: 0, size: 0 },
      search: { hits: 0, misses: 0, evictions: 0, size: 0 },
      overallHitRate: 0,
    };
  }
}
