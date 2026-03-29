import { Message } from './llm';
import { GapStatus } from './agent';
import type { Collaboration, CollaborationRole, ParticipantType } from './collaboration';

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
  /** Optional expiration timestamp (Unix epoch) for transient insights. */
  expiration?: number;
  /** Number of times this memory has been successfully recalled by an agent. */
  hitCount?: number;
  /** Timestamp (Unix epoch) of the last time this memory was recalled. */
  lastAccessed?: number;
  /** Number of times we have attempted to resolve this gap. */
  retryCount?: number;
  /** Timestamp (Unix epoch) of the last retry attempt. */
  lastAttemptTime?: number;
  /** Timestamp (Unix epoch) when the memory was first recorded. */
  createdAt?: number;
}

/**
 * A discrete piece of knowledge or an identified gap in the system's memory.
 */
export interface MemoryInsight {
  /** Unique identifier for the insight. */
  id: string;
  /** The textual content or description of the insight. */
  content: string;
  /** Strategic and operational metadata. */
  metadata: InsightMetadata;
  /** Timestamp (Unix epoch) when the insight was first recorded or last updated. */
  timestamp: number;
  /** Timestamp (Unix epoch) when the insight was first recorded. */
  createdAt?: number;
}

/**
 * Represents an identified capability gap, used primarily in dashboard views.
 */
export interface GapItem {
  userId: string;
  timestamp: number;
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
  updatedAt: number;
  /** Whether the session is pinned to the top. */
  isPinned?: boolean;
  /** Optional expiration timestamp (Unix epoch). */
  expiresAt?: number;
}

/**
 * Interface for managing conversation history and session metadata.
 */
export interface IHistoryStore {
  /** Retrieves the conversation history for a specific user or session. */
  getHistory(userId: string): Promise<Message[]>;
  /** Appends a new message to the conversation history. */
  addMessage(userId: string, message: Message): Promise<void>;
  /** Clears the conversation history for a specific user or session. */
  clearHistory(userId: string): Promise<void>;
  /** Lists all available conversation sessions for a user. */
  listConversations(userId: string): Promise<ConversationMeta[]>;
  /** Saves or updates metadata for a specific conversation session. */
  saveConversationMeta(
    userId: string,
    sessionId: string,
    meta: Partial<ConversationMeta>
  ): Promise<void>;
  /** Deletes a conversation session and its history. */
  deleteConversation(userId: string, sessionId: string): Promise<void>;
  /** Retrieves the latest summary for a conversation session. */
  getSummary(userId: string): Promise<string | null>;
  /** Updates the latest summary for a conversation session. */
  updateSummary(userId: string, summary: string): Promise<void>;
}

/**
 * Interface for managing distilled knowledge and lessons learned from agent operations.
 */
export interface IKnowledgeStore {
  /** Retrieves the distilled "long-term" memory facts for a user. */
  getDistilledMemory(userId: string): Promise<string>;
  /** Updates the distilled long-term memory facts for a user. */
  updateDistilledMemory(userId: string, facts: string): Promise<void>;
  /** Adds a tactical lesson learned during an agent's task execution. */
  addLesson(userId: string, lesson: string, metadata?: InsightMetadata): Promise<void>;
  /** Retrieves a set of recent tactical lessons for a user. */
  getLessons(userId: string): Promise<string[]>;
  /** Records a failure pattern for future cross-referencing. */
  recordFailurePattern(
    scopeId: string,
    content: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number>;
  /** Retrieves failure patterns relevant to the given context. */
  getFailurePatterns(scopeId: string, context?: string, limit?: number): Promise<MemoryInsight[]>;
  /** Adds a system-wide lesson that benefits ALL users and sessions. */
  addGlobalLesson(lesson: string, metadata?: Partial<InsightMetadata>): Promise<number>;
  /** Retrieves system-wide lessons for injection into agent prompts. */
  getGlobalLessons(limit?: number): Promise<string[]>;
  /** Retrieves low-utilization memory items for pruning or auditing. */
  getLowUtilizationMemory(limit?: number): Promise<Record<string, unknown>[]>;
}

/**
 * Interface for managing capability gaps and strategic system evolution.
 */
export interface IGapManager {
  /** Records a new identified capability gap in the system. */
  setGap(gapId: string, details: string, metadata?: InsightMetadata): Promise<void>;
  /** Retrieves all capability gaps, optionally filtered by their current status. */
  getAllGaps(status?: string): Promise<MemoryInsight[]>;
  /** Updates the lifecycle status of a specific capability gap. */
  updateGapStatus(gapId: string, status: string): Promise<void>;
  /** Archives stale gaps older than specified days. Returns count of archived gaps. */
  archiveStaleGaps(staleDays?: number): Promise<number>;
  /** Atomically increments the attempt counter on a capability gap. */
  incrementGapAttemptCount(gapId: string): Promise<number>;
  /** Acquires a lock on a gap to prevent concurrent modification by multiple agents. */
  acquireGapLock(gapId: string, agentId: string, ttlMs?: number): Promise<boolean>;
  /** Releases a gap lock after work is complete. */
  releaseGapLock(gapId: string, agentId: string): Promise<void>;
  /** Checks if a gap is currently locked and returns the lock holder info. */
  getGapLock(gapId: string): Promise<{ content: string; expiresAt: number } | null>;
  /** Updates metadata fields (impact, priority, etc.) on a specific gap. */
  updateGapMetadata(gapId: string, metadata: Partial<InsightMetadata>): Promise<void>;
  /** Records a failed strategic plan so the swarm learns anti-patterns. */
  recordFailedPlan(
    planHash: string,
    planContent: string,
    gapIds: string[],
    failureReason: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number>;
  /** Retrieves previously failed plans to inform the planner about what NOT to do. */
  getFailedPlans(limit?: number): Promise<MemoryInsight[]>;
}

/**
 * Unified interface for agent memory, providing a comprehensive view of historical,
 * tactical, and strategic knowledge.
 */
export interface IMemory extends IHistoryStore, IKnowledgeStore, IGapManager {
  /** Searches across all memory types (lessons, gaps, distilled) using keyword search. */
  searchInsights(
    userId?: string,
    query?: string,
    category?: InsightCategory,
    limit?: number,
    lastEvaluatedKey?: Record<string, unknown>
  ): Promise<{ items: MemoryInsight[]; lastEvaluatedKey?: Record<string, unknown> }>;

  /** Adds a new granular memory item into the user or global scope. */
  addMemory(
    scopeId: string,
    category: InsightCategory | string,
    content: string,
    metadata?: Partial<InsightMetadata>
  ): Promise<number>;

  /** Updates the metadata (priority, impact, etc.) for a specific recorded insight. */
  updateInsightMetadata(
    userId: string,
    timestamp: number,
    metadata: Partial<InsightMetadata>
  ): Promise<void>;

  /**
   * Universal fetcher for memory items by their prefix.
   */
  listByPrefix(prefix: string): Promise<Record<string, unknown>[]>;

  /** Saves a clarification request to DynamoDB for state persistence. */
  saveClarificationRequest(
    state: Omit<ClarificationState, 'type' | 'expiresAt' | 'timestamp'>
  ): Promise<void>;

  /** Retrieves a clarification request by traceId and agentId. */
  getClarificationRequest(traceId: string, agentId: string): Promise<ClarificationState | null>;

  /** Updates the status of a clarification request. */
  updateClarificationStatus(
    traceId: string,
    agentId: string,
    status: ClarificationStatus
  ): Promise<void>;

  /** Saves escalation state for a clarification. */
  saveEscalationState(state: import('./escalation').EscalationState): Promise<void>;

  /** Retrieves escalation state for a clarification. */
  getEscalationState(
    traceId: string,
    agentId: string
  ): Promise<import('./escalation').EscalationState | null>;

  /** Finds all expired clarification requests (for orphan detection). */
  findExpiredClarifications(): Promise<ClarificationState[]>;

  /** Increments the retry count for a clarification request. */
  incrementClarificationRetry(traceId: string, agentId: string): Promise<number>;

  // Collaboration Operations

  /** Gets a collaboration by ID. */
  getCollaboration(collaborationId: string): Promise<Collaboration | null>;

  /** Checks if a participant has access to a collaboration. */
  checkCollaborationAccess(
    collaborationId: string,
    participantId: string,
    participantType: ParticipantType,
    requiredRole?: CollaborationRole
  ): Promise<boolean>;

  /** Closes a collaboration. */
  closeCollaboration(
    collaborationId: string,
    actorId: string,
    actorType: ParticipantType
  ): Promise<void>;

  /** Creates a new collaboration with a shared session. */
  createCollaboration(
    ownerId: string,
    ownerType: ParticipantType,
    input: import('./collaboration').CreateCollaborationInput
  ): Promise<Collaboration>;

  /** Lists collaborations for a participant. */
  listCollaborationsForParticipant(
    participantId: string,
    participantType: ParticipantType
  ): Promise<
    Array<{
      collaborationId: string;
      role: CollaborationRole;
      collaborationName: string;
    }>
  >;
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
  timestamp: number;
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
}
