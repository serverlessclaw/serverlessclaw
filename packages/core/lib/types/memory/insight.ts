import { GapStatus } from '../agent';

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
