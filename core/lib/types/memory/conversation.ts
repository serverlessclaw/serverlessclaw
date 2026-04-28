/**
 * Operational phase within a mission.
 */
export interface MissionPhase {
  id: string;
  label: string;
  status: 'completed' | 'active' | 'pending';
}

/**
 * Metadata specifically for the Mission Control and Mission Hub sidebars.
 */
export interface MissionMetadata {
  name?: string;
  status?: string;
  goal?: string;
  phases?: MissionPhase[];
  trustScore?: number;
  stabilityScore?: number;
  budgetUsage?: number;
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
  /** Mission-specific metadata for War Room mode. */
  mission?: MissionMetadata;
  /** Additional dynamic metadata */
  metadata?: Record<string, unknown>;
}
