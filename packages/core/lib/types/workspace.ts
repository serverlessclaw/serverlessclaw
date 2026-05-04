/**
 * Workspace Types
 *
 * A Workspace is the multi-tenancy primitive for multi-human multi-agent collaboration.
 * It provides a shared context with role-based access control for both humans and agents.
 */

/** Member roles within a workspace. Hierarchical: owner > admin > collaborator > observer. */
export type WorkspaceRole = 'owner' | 'admin' | 'collaborator' | 'observer';

/** Type of member: human (via channel) or agent (via AgentBus). */
export type MemberType = 'human' | 'agent';

/** Channel profile for human members — how they receive notifications. */
export interface ChannelProfile {
  /** Messaging platform (telegram, discord, slack, dashboard, email). */
  platform: string;
  /** Platform-specific identifier (Telegram chat ID, Discord user ID, etc.). */
  identifier: string;
  /** Whether this channel is currently active for notifications. */
  enabled: boolean;
}

/** A member of a workspace (human or agent). */
export interface WorkspaceMember {
  /** Unique ID: human Telegram ID, agent ID, or dashboard auth ID. */
  memberId: string;
  /** Whether this is a human or agent member. */
  type: MemberType;
  /** Display name. */
  displayName: string;
  /** Access role. */
  role: WorkspaceRole;
  /** Channel profiles for notification delivery (humans only). */
  channels?: ChannelProfile[];
  /** When this member joined. */
  joinedAt: number;
  /** Whether this member is currently active. */
  active: boolean;
}

/** Workspace configuration and metadata. */
export interface Workspace {
  /** Unique workspace identifier. */
  workspaceId: string;
  /** Organizational identifier for enterprise isolation. */
  orgId?: string;
  /** Team identifier for enterprise isolation. */
  teamId?: string;
  /** Human-readable workspace name. */
  name: string;
  /** Optional description of the workspace purpose. */
  description?: string;
  /** The owner (must be a human). */
  ownerId: string;
  /** All workspace members. */
  members: WorkspaceMember[];
  /** Active collaboration sessions within this workspace. */
  activeCollaborations: string[];
  /** Workspace creation timestamp. */
  createdAt: number;
  /** Last modification timestamp. */
  updatedAt: number;
  /** Optional TTL epoch seconds for auto-cleanup. */
  expiresAt?: number;
  /** Workspace status. */
  status: 'active' | 'suspended' | 'archived';
}

/** Input for creating a new workspace. */
export interface CreateWorkspaceInput {
  /** Human-readable name. */
  name: string;
  /** Organizational identifier. */
  orgId?: string;
  /** Team identifier. */
  teamId?: string;
  /** Optional description. */
  description?: string;
  /** The owner's member ID (must be human). */
  ownerId: string;
  /** Owner display name. */
  ownerDisplayName: string;
  /** Owner channel profiles for notifications. */
  ownerChannels?: ChannelProfile[];
  /** Optional TTL in days. */
  ttlDays?: number;
}

/** Input for inviting a member to a workspace. */
export interface InviteMemberInput {
  /** Target workspace. */
  workspaceId: string;
  /** New member ID. */
  memberId: string;
  /** Human or agent. */
  type: MemberType;
  /** Display name. */
  displayName: string;
  /** Initial role. */
  role: WorkspaceRole;
  /** Channel profiles (for humans). */
  channels?: ChannelProfile[];
}

/**
 * Checks if a role has sufficient permissions for an action.
 *
 * @param memberRole - The role of the member performing the action.
 * @param requiredRole - The minimum role required for the action.
 */
export function hasPermission(memberRole: WorkspaceRole, requiredRole: WorkspaceRole): boolean {
  const hierarchy: Record<WorkspaceRole, number> = {
    owner: 4,
    admin: 3,
    collaborator: 2,
    observer: 1,
  };
  return hierarchy[memberRole] >= hierarchy[requiredRole];
}

/** Generates the DynamoDB partition key for a workspace. */
export function workspaceKey(workspaceId: string): string {
  return `WORKSPACE#${workspaceId}`;
}

/**
 * User roles from IdentityManager (core identity layer).
 */
export type IdentityUserRole = 'owner' | 'admin' | 'member' | 'viewer';

/**
 * Maps IdentityManager UserRole to WorkspaceRole.
 * Used when a human user needs workspace-scoped permissions.
 */
export function userRoleToWorkspaceRole(userRole: IdentityUserRole): WorkspaceRole {
  const mapping: Record<IdentityUserRole, WorkspaceRole> = {
    owner: 'owner',
    admin: 'admin',
    member: 'collaborator',
    viewer: 'observer',
  };
  return mapping[userRole] ?? 'observer';
}

/**
 * Maps WorkspaceRole to IdentityManager UserRole.
 * Used when checking workspace permissions for API access.
 */
export function workspaceRoleToUserRole(workspaceRole: WorkspaceRole): IdentityUserRole {
  const mapping: Record<WorkspaceRole, IdentityUserRole> = {
    owner: 'owner',
    admin: 'admin',
    collaborator: 'member',
    observer: 'viewer',
  };
  return mapping[workspaceRole] ?? 'viewer';
}
