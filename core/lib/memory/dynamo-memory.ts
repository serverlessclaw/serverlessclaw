import {
  IMemory,
  Message,
  InsightMetadata,
  MemoryInsight,
  InsightCategory,
  GapStatus,
  GapTransitionResult,
  ConversationMeta,
} from '../types/index';
import { BaseMemoryProvider } from './base';
import { LIMITS } from '../constants';
export { CachedMemory } from './cached-memory';

// Import operations from submodules
import * as GapOps from './gap-operations';
import * as InsightOps from './insight-operations';
import * as SessionOps from './session-operations';
import * as MemoryUtils from './utils';
import * as ClarificationOps from './clarification-operations';
import * as CollaborationOps from './collaboration-operations';

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
  async updateGapStatus(gapId: string, status: GapStatus): Promise<GapTransitionResult> {
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
    metadata?: Partial<InsightMetadata> & { orgId?: string; tags?: string[] }
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
    lastEvaluatedKey?: Record<string, unknown>,
    tags?: string[],
    orgId?: string
  ): Promise<{ items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }> {
    return InsightOps.searchInsights(
      this,
      userId,
      query,
      category,
      limit,
      lastEvaluatedKey,
      tags,
      orgId
    );
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
   * Refines an existing memory item by updating its content or metadata.
   */
  async refineMemory(
    userId: string,
    timestamp: number,
    content?: string,
    metadata?: Partial<InsightMetadata> & { tags?: string[] }
  ): Promise<void> {
    return InsightOps.refineMemory(this, userId, timestamp, content, metadata);
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
   * Retrieves a configuration item from the system config registry.
   */
  async getConfig(key: string): Promise<unknown> {
    const { AgentRegistry } = await import('../registry');
    return AgentRegistry.getRawConfig(key);
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
    state: Omit<import('../types/memory').ClarificationState, 'type' | 'expiresAt' | 'timestamp'>
  ): Promise<void> {
    return ClarificationOps.saveClarificationRequest(this, state);
  }

  /**
   * Retrieves a clarification request by traceId and agentId.
   */
  async getClarificationRequest(
    traceId: string,
    agentId: string
  ): Promise<import('../types/memory').ClarificationState | null> {
    return ClarificationOps.getClarificationRequest(this, traceId, agentId);
  }

  /**
   * Updates the status of a clarification request.
   */
  async updateClarificationStatus(
    traceId: string,
    agentId: string,
    status: import('../types/memory').ClarificationStatus
  ): Promise<void> {
    return ClarificationOps.updateClarificationStatus(this, traceId, agentId, status);
  }

  /**
   * Saves escalation state for a clarification.
   */
  async saveEscalationState(state: import('../types/escalation').EscalationState): Promise<void> {
    return ClarificationOps.saveEscalationState(this, state);
  }

  /**
   * Retrieves escalation state for a clarification.
   */
  async getEscalationState(
    traceId: string,
    agentId: string
  ): Promise<import('../types/escalation').EscalationState | null> {
    return ClarificationOps.getEscalationState(this, traceId, agentId);
  }

  /**
   * Finds all expired clarification requests (for orphan detection).
   */
  async findExpiredClarifications(): Promise<import('../types/memory').ClarificationState[]> {
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

  /**
   * Acquires a lock on a gap to prevent concurrent modification by multiple agents.
   */
  async acquireGapLock(gapId: string, agentId: string, ttlMs?: number): Promise<boolean> {
    return GapOps.acquireGapLock(this, gapId, agentId, ttlMs);
  }

  /**
   * Releases a gap lock after work is complete.
   */
  async releaseGapLock(gapId: string, agentId: string): Promise<void> {
    return GapOps.releaseGapLock(this, gapId, agentId);
  }

  /**
   * Checks if a gap is currently locked and returns the lock holder info.
   */
  async getGapLock(gapId: string): Promise<{ content: string; expiresAt: number } | null> {
    return GapOps.getGapLock(this, gapId);
  }

  /**
   * Retrieves a specific capability gap by its ID.
   */
  async getGap(gapId: string): Promise<MemoryInsight | null> {
    return GapOps.getGap(this, gapId);
  }

  /**
   * Updates metadata fields (impact, priority, etc.) on a specific gap.
   */
  async updateGapMetadata(gapId: string, metadata: Partial<InsightMetadata>): Promise<void> {
    return GapOps.updateGapMetadata(this, gapId, metadata);
  }

  /**
   * Records a failed strategic plan so the swarm learns anti-patterns.
   */
  async recordFailedPlan(
    planHash: string,
    planContent: string,
    gapIds: string[],
    failureReason: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number> {
    return InsightOps.recordFailedPlan(
      this,
      planHash,
      planContent,
      gapIds,
      failureReason,
      metadata
    );
  }

  /**
   * Retrieves previously failed plans to inform the planner about anti-patterns.
   */
  async getFailedPlans(limit?: number): Promise<MemoryInsight[]> {
    return InsightOps.getFailedPlans(this, limit);
  }

  /**
   * Adds a system-wide lesson that benefits ALL users and sessions.
   */
  async addGlobalLesson(lesson: string, metadata?: Partial<InsightMetadata>): Promise<number> {
    return InsightOps.addGlobalLesson(this, lesson, metadata);
  }

  /**
   * Retrieves system-wide lessons for injection into agent prompts.
   */
  async getGlobalLessons(limit?: number): Promise<string[]> {
    return InsightOps.getGlobalLessons(this, limit);
  }

  // Collaboration Operations

  /**
   * Creates a new collaboration with a shared session.
   */
  async createCollaboration(
    ownerId: string,
    ownerType: import('../types/collaboration').ParticipantType,
    input: import('../types/collaboration').CreateCollaborationInput
  ): Promise<import('../types/collaboration').Collaboration> {
    return CollaborationOps.createCollaboration(this, ownerId, ownerType, input);
  }

  /**
   * Gets a collaboration by ID.
   */
  async getCollaboration(
    collaborationId: string
  ): Promise<import('../types/collaboration').Collaboration | null> {
    return CollaborationOps.getCollaboration(this, collaborationId);
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
    }
  ): Promise<void> {
    return CollaborationOps.addCollaborationParticipant(
      this,
      collaborationId,
      actorId,
      actorType,
      newParticipant
    );
  }

  /**
   * Lists collaborations for a participant.
   */
  async listCollaborationsForParticipant(
    participantId: string,
    participantType: import('../types/collaboration').ParticipantType
  ): Promise<
    Array<{
      collaborationId: string;
      role: import('../types/collaboration').CollaborationRole;
      collaborationName: string;
    }>
  > {
    return CollaborationOps.listCollaborationsForParticipant(this, participantId, participantType);
  }

  /**
   * Checks if a participant has access to a collaboration.
   */
  async checkCollaborationAccess(
    collaborationId: string,
    participantId: string,
    participantType: import('../types/collaboration').ParticipantType,
    requiredRole?: import('../types/collaboration').CollaborationRole
  ): Promise<boolean> {
    return CollaborationOps.checkCollaborationAccess(
      this,
      collaborationId,
      participantId,
      participantType,
      requiredRole
    );
  }

  /**
   * Closes a collaboration.
   */
  async closeCollaboration(
    collaborationId: string,
    actorId: string,
    actorType: import('../types/collaboration').ParticipantType
  ): Promise<void> {
    return CollaborationOps.closeCollaboration(this, collaborationId, actorId, actorType);
  }
}
