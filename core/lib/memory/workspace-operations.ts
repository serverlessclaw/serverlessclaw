/**
 * Workspace Operations Module
 *
 * CRUD operations for the Workspace multi-tenancy primitive.
 * Workspaces are stored in the ConfigTable for global access.
 */

import { logger } from '../logger';
import { ConfigManager } from '../registry/config';
import type {
  Workspace,
  WorkspaceMember,
  CreateWorkspaceInput,
  InviteMemberInput,
  WorkspaceRole,
  ChannelProfile,
} from '../types/workspace';
import { workspaceKey, hasPermission } from '../types/workspace';
import { generateWorkspaceId } from '../utils/id-generator';

const WORKSPACE_INDEX = 'workspace_index';

/**
 * Creates a new workspace with the specified owner.
 *
 * @param input - The workspace creation parameters including owner details.
 */
export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const workspaceId = generateWorkspaceId();
  const now = Date.now();

  const owner: WorkspaceMember = {
    memberId: input.ownerId,
    type: 'human',
    displayName: input.ownerDisplayName,
    role: 'owner',
    channels: input.ownerChannels ?? [],
    joinedAt: now,
    active: true,
  };

  const workspace: Workspace = {
    workspaceId,
    name: input.name,
    description: input.description,
    ownerId: input.ownerId,
    members: [owner],
    activeCollaborations: [],
    createdAt: now,
    updatedAt: now,
    expiresAt: input.ttlDays ? Math.floor((now + input.ttlDays * 86400000) / 1000) : undefined,
    status: 'active',
  };

  // Store workspace by ID
  await ConfigManager.saveRawConfig(workspaceKey(workspaceId), workspace);

  // Register in workspace index for listing
  await ConfigManager.appendToList(WORKSPACE_INDEX, workspaceId);

  logger.info(`[Workspace] Created: ${workspaceId} (${input.name}) by ${input.ownerId}`);
  return workspace;
}

/**
 * Retrieves a workspace by ID.
 *
 * @param workspaceId - The ID of the workspace.
 * @param requesterId - Optional ID of the member requesting access (for RBAC check).
 */
export async function getWorkspace(
  workspaceId: string,
  requesterId?: string
): Promise<Workspace | null> {
  const data = await ConfigManager.getRawConfig(workspaceKey(workspaceId));
  const workspace = (data as Workspace) ?? null;

  if (workspace && requesterId) {
    const isMember = workspace.members.some((m) => m.memberId === requesterId && m.active);
    if (!isMember) {
      logger.warn(`[Workspace] Access denied: ${requesterId} to ${workspaceId}`);
      throw new Error(`Access denied to workspace: ${workspaceId}`);
    }
  }

  return workspace;
}

/**
 * Lists all workspace IDs.
 */
export async function listWorkspaceIds(): Promise<string[]> {
  const index = await ConfigManager.getRawConfig(WORKSPACE_INDEX);
  return (index as string[]) ?? [];
}

/**
 * Invites a member to a workspace.
 *
 * @param workspaceId - The ID of the workspace to invite to.
 * @param inviterId - The ID of the member issuing the invitation (must be admin or owner).
 * @param input - The invitation details including new member info.
 */
export async function inviteMember(
  workspaceId: string,
  inviterId: string,
  input: InviteMemberInput
): Promise<Workspace> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  // Check inviter permissions (must be admin or owner)
  const inviter = workspace.members.find((m) => m.memberId === inviterId);
  if (!inviter || !hasPermission(inviter.role, 'admin')) {
    throw new Error(`Insufficient permissions: ${inviterId} cannot invite members`);
  }

  // Prevent multiple owners
  if (input.role === 'owner' && workspace.members.some((m) => m.role === 'owner')) {
    throw new Error(`Workspace already has an owner. Cannot invite ${input.memberId} as owner.`);
  }

  // Check for duplicate
  if (workspace.members.some((m) => m.memberId === input.memberId)) {
    throw new Error(`Member already exists: ${input.memberId}`);
  }

  const newMember: WorkspaceMember = {
    memberId: input.memberId,
    type: input.type,
    displayName: input.displayName,
    role: input.role,
    channels: input.channels ?? [],
    joinedAt: Date.now(),
    active: true,
  };

  workspace.members.push(newMember);
  workspace.updatedAt = Date.now();

  await ConfigManager.saveRawConfig(workspaceKey(workspaceId), workspace);
  logger.info(`[Workspace] Member invited: ${input.memberId} to ${workspaceId} as ${input.role}`);
  return workspace;
}

/**
 * Updates a member's role within a workspace.
 *
 * @param workspaceId - The ID of the workspace.
 * @param updaterId - The ID of the member making the change (must be admin or owner).
 * @param targetMemberId - The ID of the member whose role is being updated.
 * @param newRole - The new role to assign.
 */
export async function updateMemberRole(
  workspaceId: string,
  updaterId: string,
  targetMemberId: string,
  newRole: WorkspaceRole
): Promise<Workspace> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  const updater = workspace.members.find((m) => m.memberId === updaterId);
  if (!updater || !hasPermission(updater.role, 'admin')) {
    throw new Error(`Insufficient permissions: ${updaterId} cannot update roles`);
  }

  // Cannot change owner's role
  if (targetMemberId === workspace.ownerId && newRole !== 'owner') {
    throw new Error('Cannot change the workspace owner role');
  }

  const target = workspace.members.find((m) => m.memberId === targetMemberId);
  if (!target) throw new Error(`Member not found: ${targetMemberId}`);

  target.role = newRole;
  workspace.updatedAt = Date.now();

  await ConfigManager.saveRawConfig(workspaceKey(workspaceId), workspace);
  logger.info(`[Workspace] Role updated: ${targetMemberId} -> ${newRole} in ${workspaceId}`);
  return workspace;
}

/**
 * Removes a member from a workspace.
 *
 * @param workspaceId - The ID of the workspace.
 * @param removerId - The ID of the member issuing the removal (must be admin or owner).
 * @param targetMemberId - The ID of the member to remove.
 */
export async function removeMember(
  workspaceId: string,
  removerId: string,
  targetMemberId: string
): Promise<Workspace> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  const remover = workspace.members.find((m) => m.memberId === removerId);
  if (!remover || !hasPermission(remover.role, 'admin')) {
    throw new Error(`Insufficient permissions: ${removerId} cannot remove members`);
  }

  // Cannot remove owner
  if (targetMemberId === workspace.ownerId) {
    throw new Error('Cannot remove the workspace owner');
  }

  workspace.members = workspace.members.filter((m) => m.memberId !== targetMemberId);
  workspace.updatedAt = Date.now();

  await ConfigManager.saveRawConfig(workspaceKey(workspaceId), workspace);
  logger.info(`[Workspace] Member removed: ${targetMemberId} from ${workspaceId}`);
  return workspace;
}

/**
 * Gets all human members with their channel profiles for notification fan-out.
 */
export function getHumanMembersWithChannels(workspace: Workspace): Array<{
  memberId: string;
  displayName: string;
  channels: ChannelProfile[];
}> {
  return workspace.members
    .filter((m) => m.type === 'human' && m.active)
    .map((m) => ({
      memberId: m.memberId,
      displayName: m.displayName,
      channels: m.channels ?? [],
    }));
}

/**
 * Gets all agent members in a workspace.
 */
export function getAgentMembers(workspace: Workspace): Array<{
  memberId: string;
  displayName: string;
  role: WorkspaceRole;
}> {
  return workspace.members
    .filter((m) => m.type === 'agent' && m.active)
    .map((m) => ({
      memberId: m.memberId,
      displayName: m.displayName,
      role: m.role,
    }));
}
