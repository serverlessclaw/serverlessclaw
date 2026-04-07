/**
 * Collaboration Types
 * Enables multi-party agent-agent and agent-human collaboration via shared sessions
 */

export type CollaborationRole = 'owner' | 'editor' | 'viewer';

export type ParticipantType = 'agent' | 'human';

export interface CollaborationParticipant {
  type: ParticipantType;
  id: string;
  role: CollaborationRole;
  joinedAt: number;
}

export interface Collaboration {
  collaborationId: string;
  name: string;
  description?: string;

  // Session linkage
  sessionId: string;
  syntheticUserId: string; // e.g., "shared#collab-abc123"

  // Participants
  owner: { type: ParticipantType; id: string };
  participants: CollaborationParticipant[];

  // Lifecycle
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  expiresAt?: number;
  timeoutMs?: number; // Custom timeout for conflict resolution
  status: 'active' | 'closed' | 'archived';

  // Metadata
  tags?: string[];
  workspaceId?: string;
}

export interface CreateCollaborationInput {
  name: string;
  description?: string;
  sessionId?: string; // Optional, auto-generated if not provided
  ttlDays?: number;
  timeoutMs?: number;
  tags?: string[];
  initialParticipants?: Array<{
    type: ParticipantType;
    id: string;
    role: CollaborationRole;
  }>;
  workspaceId?: string;
}

/**
 * Helper to generate synthetic userId for shared sessions
 */
export function getSyntheticUserId(collaborationId: string): string {
  return `shared#collab#${collaborationId}`;
}

/**
 * Helper to extract collaborationId from synthetic userId
 */
export function parseSyntheticUserId(syntheticUserId: string): string | null {
  const match = syntheticUserId.match(/^shared#collab#(.+)$/);
  return match ? match[1] : null;
}
