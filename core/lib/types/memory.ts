import { Message } from './llm';
import { GapStatus, GapTransitionResult } from './agent';
import type { Collaboration, CollaborationRole, ParticipantType } from './collaboration';

// DO NOT RE-EXPORT GapStatus or Message from here.
// They are exported by index.ts via agent.ts and llm.ts.

/**
 * Categories for memory insights to help the agent organize and prioritize knowledge.
 */
export enum InsightCategory {
  /** User-specific preferences and habits. */
  USER_PREFERENCE = 'user_preference',
  /** Actionable lessons learned from past successes or failures. */
  TACTICAL_LESSON = 'tactical_lesson',
  /** Identified missing capabilities or system limitations. */
  STRATEGIC_GAP = 'strategic_gap',
  /** General system-wide knowledge and facts. */
  SYSTEM_KNOWLEDGE = 'system_knowledge',
  /** Recurring failure patterns: tool misuse, hallucinations, timeouts. */
  FAILURE_PATTERN = 'failure_pattern',
  /** Proactive suggestions for system optimization or refinement. */
  SYSTEM_IMPROVEMENT = 'system_improvement',
  /** Architecture patterns, ADRs, and structural standards. */
  ARCHITECTURE = 'architecture',
  /** Security policies, boundaries, and threat models. */
  SECURITY = 'security',
}

/**
 * Metadata associated with a memory insight for prioritization and lifecycle management.
 */
export interface InsightMetadata {
  /** The category of the insight. */
  category: InsightCategory | string;
  /** 0-10 confidence score of the insight's accuracy. */
  confidence: number;
  /** 0-10 impact score of the insight on system performance or user experience. */
  impact: number;
  /** 0-10 complexity score for addressing the insight (if a gap). */
  complexity: number;
  /** 0-10 risk score associated with the insight or gap. */
  risk: number;
  /** 0-10 urgency score for addressing the insight or gap. */
  urgency: number;
  /** 0-10 global priority score calculated from other metrics. */
  priority: number;
  /** Number of times this memory has been successfully recalled by an agent. */
  hitCount?: number;
  /** Timestamp (Unix epoch) of the last time this memory was recalled. */
  lastAccessed?: number;
  /** Internal retry counter for operational tasks (e.g., deployments). */
  retryCount?: number;
  /** Timestamp of the last operational attempt. */
  lastAttemptTime?: number;
  /** Timestamp (Unix epoch) when the insight was first recorded. */
  createdAt?: number;
  /** Session ID for HITL approval flow */
  sessionId?: string;
  /** User ID who requested the action requiring approval */
  requestingUserId?: string;
  /** Additional dynamic metadata */
  [key: string]: unknown;
}

/**
 * A discrete piece of knowledge or an identified gap in the system's memory.
 */
export interface MemoryInsight {
  /** Unique identifier for the insight. */
  id: string;
  /** The DynamoDB record type (e.g. MEMORY:LESSON). */
  type: string;
  /** The textual content or description of the insight. */
  content: string;
  /** Strategic and operational metadata. */
  metadata: InsightMetadata;
  /** Timestamp (Unix epoch) when the insight was first recorded or last updated. */
  timestamp: number | string;
  /** Team scope within organization. */
  teamId?: string;
  /** Staff scope. */
  staffId?: string;
  /** User-specific scope within the organization. */
  userId?: string;
  /** Workspace-specific scope (multi-tenant support). */
  workspaceId?: string;
  /** Optional tags for flexible categorization and retrieval. */
  tags?: string[];
  /** Lifecycle status (primarily for gaps). */
  status?: GapStatus;
  /** Timestamp (Unix epoch) when the insight was first recorded. */
  createdAt?: number;
}

/**
 * Scoping identifiers for multi-tenant and organizational isolation.
 */
export interface ContextualScope {
  workspaceId?: string;
  teamId?: string;
  staffId?: string;
}

/**
 * Represents an identified capability gap, used primarily in dashboard views.
 */
export interface GapItem {
  userId: string;
  timestamp: number | string;
  createdAt?: number;
  content: string;
  status: GapStatus;
  metadata?: {
    impact?: number;
    priority?: number;
  };
}

/**
 * Metadata for a chat conversation session.
 */
export interface ConversationMeta {
  /** Unique session identifier. */
  sessionId: string;
  /** User-facing or system-generated title for the conversation. */
  title: string;
  /** Snippet or full text of the last message in the conversation. */
  lastMessage: string;
  /** Timestamp (Unix epoch) of the last message. */
  updatedAt: number | string;
  /** Whether the session is pinned to the top. */
  isPinned?: boolean;
  /** Optional expiration timestamp (Unix epoch). */
  expiresAt?: number;
  /** Additional dynamic metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Interface for managing conversation history and session metadata.
 */
export interface IHistoryStore {
  /** Retrieves the conversation history for a specific user or session. */
  getHistory(userId: string, scope?: string | ContextualScope): Promise<Message[]>;
  /** Appends a new message to the conversation history. */
  addMessage(userId: string, message: Message, scope?: string | ContextualScope): Promise<void>;
  /** Clears the conversation history for a specific user or session. */
  clearHistory(userId: string, scope?: string | ContextualScope): Promise<void>;
  /** Lists all available conversation sessions for a user. */
  listConversations(userId: string, scope?: string | ContextualScope): Promise<ConversationMeta[]>;
  /** Saves or updates metadata for a specific conversation session. */
  saveConversationMeta(
    userId: string,
    sessionId: string,
    meta: Partial<ConversationMeta>,
    scope?: string | ContextualScope
  ): Promise<void>;
  /** Deletes a conversation session and its history. */
  deleteConversation(
    userId: string,
    sessionId: string,
    scope?: string | ContextualScope
  ): Promise<void>;
  /** Retrieves the latest summary for a conversation session. */
  getSummary(userId: string, scope?: string | ContextualScope): Promise<string | null>;
  /** Updates the latest summary for a conversation session. */
  updateSummary(userId: string, summary: string, scope?: string | ContextualScope): Promise<void>;
}

/**
 * Interface for managing distilled knowledge and lessons learned from agent operations.
 */
export interface IKnowledgeStore {
  /** Retrieves the distilled "long-term" memory facts for a user. */
  getDistilledMemory(userId: string, scope?: string | ContextualScope): Promise<string>;
  /** Updates the distilled long-term memory facts for a user. */
  updateDistilledMemory(
    userId: string,
    facts: string,
    scope?: string | ContextualScope
  ): Promise<void>;
  /** Adds a tactical lesson learned during an agent's task execution. */
  addLesson(
    userId: string,
    lesson: string,
    metadata?: Partial<InsightMetadata> & { tags?: string[] },
    scope?: string | ContextualScope
  ): Promise<void>;
  /** Retrieves a set of recent tactical lessons for a user. */
  getLessons(userId: string, scope?: string | ContextualScope): Promise<string[]>;
  /** Records a failure pattern for future cross-referencing. */
  recordFailurePattern(
    planHash: string,
    planContent: string,
    gapIds: string[],
    failureReason: string,
    metadata?: Partial<InsightMetadata>,
    scope?: string | ContextualScope
  ): Promise<number | string>;
  /** Retrieves failure patterns relevant to the given context. */
  getFailurePatterns(limit?: number, scope?: string | ContextualScope): Promise<MemoryInsight[]>;
  /** Adds a system-wide lesson that benefits ALL users and sessions. */
  addGlobalLesson(lesson: string, metadata?: Partial<InsightMetadata>): Promise<number | string>;
  /** Retrieves system-wide lessons for injection into agent prompts. */
  getGlobalLessons(limit?: number): Promise<string[]>;
  /** Retrieves low-utilization memory items for pruning or auditing. */
  getLowUtilizationMemory(limit?: number): Promise<Record<string, unknown>[]>;
  /** Refines an existing memory item by updating its content or metadata. */
  refineMemory(
    userId: string,
    timestamp: number | string,
    content?: string,
    metadata?: Partial<InsightMetadata> & { tags?: string[] },
    scope?: string | ContextualScope
  ): Promise<void>;
  /** Saves a distilled recovery log for emergency rollback context. */
  saveDistilledRecoveryLog(traceId: string, task: string): Promise<void>;
}

/**
 * Interface for managing capability gaps and strategic system evolution.
 */
export interface IGapManager {
  /** Records a new identified capability gap in the system. */
  setGap(
    gapId: string,
    details: string,
    metadata?: InsightMetadata,
    scope?: string | ContextualScope
  ): Promise<void>;
  /** Retrieves all capability gaps, optionally filtered by their current status. */
  getAllGaps(status?: GapStatus, scope?: string | ContextualScope): Promise<MemoryInsight[]>;
  /** Updates the lifecycle status of a specific capability gap. */
  updateGapStatus(
    gapId: string,
    status: GapStatus,
    scope?: string | ContextualScope,
    metadata?: Record<string, unknown>
  ): Promise<GapTransitionResult>;
  /** Archives stale gaps older than specified days. Returns count of archived gaps. */
  archiveStaleGaps(staleDays?: number, scope?: string | ContextualScope): Promise<number>;
  /** Culls resolved gaps older than retention threshold. Returns count of culled gaps. */
  cullResolvedGaps(thresholdDays?: number, scope?: string | ContextualScope): Promise<number>;
  /** Atomically increments the attempt counter on a capability gap. */
  incrementGapAttemptCount(gapId: string, scope?: string | ContextualScope): Promise<number>;
  /** Acquires a lock on a gap to prevent concurrent modification by multiple agents. */
  acquireGapLock(gapId: string, agentId: string, ttlMs?: number): Promise<boolean>;
  /** Releases a gap lock after work is complete. */
  releaseGapLock(
    gapId: string,
    agentId: string,
    expectedVersion?: number,
    force?: boolean
  ): Promise<void>;
  /** Checks if a gap is currently locked and returns the lock holder info. */
  getGapLock(
    gapId: string
  ): Promise<{ agentId: string; expiresAt: number; lockVersion?: number } | null>;
  /** Retrieves a specific capability gap by its ID. */
  getGap(gapId: string, scope?: string | ContextualScope): Promise<MemoryInsight | null>;
  /** Updates metadata fields (impact, priority, etc.) on a specific gap. */
  updateGapMetadata(
    gapId: string,
    metadata: Partial<InsightMetadata>,
    scope?: string | ContextualScope
  ): Promise<void>;
}

/**
 * Unified interface for agent memory, providing a comprehensive view of historical,
 * tactical, and strategic knowledge.
 */
export interface IMemory extends IHistoryStore, IKnowledgeStore, IGapManager {
  /**
   * Searches for insights across all categories.
   */
  searchInsights(
    queryOrUserId?:
      | string
      | { tags?: string[]; category?: InsightCategory; limit?: number; scope?: ContextualScope },
    queryText?: string,
    category?: InsightCategory,
    limit?: number,
    lastEvaluatedKey?: Record<string, unknown>,
    tags?: string[],
    orgId?: string,
    scope?: string | ContextualScope
  ): Promise<{ items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }>;

  /** Adds a new granular memory item into the user or global scope. */
  addMemory(
    scopeId: string,
    category: InsightCategory | string,
    content: string,
    metadata?: Partial<InsightMetadata> & { tags?: string[] },
    scope?: string | ContextualScope
  ): Promise<number | string>;

  updateInsightMetadata(
    userId: string,
    timestamp: number | string,
    metadata: Partial<InsightMetadata>,
    scope?: string | ContextualScope
  ): Promise<void>;

  /**
   * Universal fetcher for memory items by their prefix.
   */
  listByPrefix(prefix: string): Promise<Record<string, unknown>[]>;

  /** Saves a clarification request to DynamoDB for state persistence. */
  saveClarificationRequest(
    state: Omit<ClarificationState, 'type' | 'expiresAt' | 'timestamp'>,
    scope?: string | ContextualScope
  ): Promise<void>;

  /** Retrieves a clarification request by traceId and agentId. */
  getClarificationRequest(
    traceId: string,
    agentId: string,
    scope?: string | ContextualScope
  ): Promise<ClarificationState | null>;

  /** Updates the status of a clarification request. */
  updateClarificationStatus(
    traceId: string,
    agentId: string,
    status: ClarificationStatus,
    scope?: string | ContextualScope
  ): Promise<void>;

  /** Saves escalation state for a clarification. */
  saveEscalationState(
    state: import('./escalation').EscalationState,
    scope?: string | ContextualScope
  ): Promise<void>;

  /** Retrieves escalation state for a clarification. */
  getEscalationState(
    traceId: string,
    agentId: string,
    scope?: string | ContextualScope
  ): Promise<import('./escalation').EscalationState | null>;

  /** Finds all expired clarification requests (for orphan detection). */
  findExpiredClarifications(scope?: string | ContextualScope): Promise<ClarificationState[]>;

  /** Increments the retry count for a clarification request. */
  incrementClarificationRetry(
    traceId: string,
    agentId: string,
    scope?: string | ContextualScope
  ): Promise<number>;

  // Collaboration Operations

  /** Gets a collaboration by ID. */
  getCollaboration(
    collaborationId: string,
    scope?: string | ContextualScope
  ): Promise<Collaboration | null>;

  /** Checks if a participant has access to a collaboration. */
  checkCollaborationAccess(
    collaborationId: string,
    participantId: string,
    participantType: ParticipantType,
    requiredRole?: CollaborationRole,
    scope?: string | ContextualScope
  ): Promise<boolean>;

  /** Closes a collaboration. */
  closeCollaboration(
    collaborationId: string,
    actorId: string,
    actorType: ParticipantType,
    scope?: string | ContextualScope
  ): Promise<void>;

  /** Creates a new collaboration with a shared session. */
  createCollaboration(
    ownerId: string,
    ownerType: ParticipantType,
    input: import('./collaboration').CreateCollaborationInput,
    scope?: string | ContextualScope
  ): Promise<Collaboration>;

  /** Lists collaborations for a participant. */
  listCollaborationsForParticipant(
    participantId: string,
    participantType: ParticipantType,
    scope?: string | ContextualScope
  ): Promise<
    Array<{
      collaborationId: string;
      role: CollaborationRole;
      collaborationName: string;
    }>
  >;

  /** Finds collaborations that have timed out based on their custom timeoutMs. */
  findStaleCollaborations(
    defaultTimeoutMs: number,
    scope?: string | ContextualScope
  ): Promise<Collaboration[]>;

  /** Transits a 1:1 session into a collaboration session. */
  transitToCollaboration(
    userId: string,
    scope: string | ContextualScope,
    sourceSessionId: string,
    invitedAgentIds: string[],
    name?: string
  ): Promise<Collaboration>;

  /**
   * Helper to derive a workspace-scoped userId for DynamoDB partition keys.
   */
  getScopedUserId(userId: string, scope?: string | ContextualScope): string;

  /** Gets cache statistics for monitoring. Returns hit rates and sizes for all caches. */
  getCacheStats(): {
    userData: { hits: number; misses: number; evictions: number; size: number };
    conversation: { hits: number; misses: number; evictions: number; size: number };
    global: { hits: number; misses: number; evictions: number; size: number };
    search: { hits: number; misses: number; evictions: number; size: number };
    overallHitRate: number;
  };
}

/**
 * Lifecycle status of a clarification request.
 */
export enum ClarificationStatus {
  /** Clarification request is pending a response. */
  PENDING = 'pending',
  /** Clarification has been answered by the initiator. */
  ANSWERED = 'answered',
  /** Clarification request timed out without a response. */
  TIMED_OUT = 'timed_out',
  /** Clarification has been escalated to a higher authority. */
  ESCALATED = 'escalated',
  /** Escalation process has been completed. */
  ESCALATION_COMPLETED = 'escalation_completed',
}

export interface ClarificationState {
  userId: string;
  timestamp: number | string;
  type: 'CLARIFICATION_PENDING';
  agentId: string;
  initiatorId: string;
  question: string;
  originalTask: string;
  traceId: string;
  sessionId?: string;
  depth: number;
  status: ClarificationStatus;
  createdAt: number;
  expiresAt: number;
  retryCount: number;
  workspaceId?: string;
}
