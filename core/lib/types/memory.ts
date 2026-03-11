import { Message } from './llm';

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
}

/**
 * Metadata associated with a memory insight for prioritization and lifecycle management.
 */
export interface InsightMetadata {
  /** The category of the insight. */
  category: InsightCategory;
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
}

/**
 * Unified interface for agent memory, providing a comprehensive view of historical,
 * tactical, and strategic knowledge.
 */
export interface IMemory extends IHistoryStore, IKnowledgeStore, IGapManager {
  /** Searches across all memory types (lessons, gaps, distilled) using keyword search. */
  searchInsights(
    userId: string,
    query: string,
    category?: InsightCategory
  ): Promise<MemoryInsight[]>;

  /** Updates the metadata (priority, impact, etc.) for a specific recorded insight. */
  updateInsightMetadata(
    userId: string,
    timestamp: number,
    metadata: Partial<InsightMetadata>
  ): Promise<void>;
}
