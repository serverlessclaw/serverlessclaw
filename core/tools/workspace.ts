import { toolDefinitions } from './definitions/index';
import { formatErrorMessage } from '../lib/utils/error';

/**
 * Creates a new workspace for multi-human multi-agent collaboration.
 */
export const CREATE_WORKSPACE = {
  ...toolDefinitions.createWorkspace,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { name, description, ownerId, ownerDisplayName } = args as {
      name: string;
      description?: string;
      ownerId: string;
      ownerDisplayName: string;
    };

    try {
      const { createWorkspace } = await import('../lib/memory/workspace-operations');
      const workspace = await createWorkspace({
        name,
        description,
        ownerId,
        ownerDisplayName,
      });

      return JSON.stringify(
        {
          status: 'created',
          workspaceId: workspace.workspaceId,
          name: workspace.name,
          owner: workspace.ownerId,
          memberCount: workspace.members.length,
        },
        null,
        2
      );
    } catch (error) {
      return `Failed to create workspace: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Invites a human or agent member to a workspace.
 */
export const INVITE_MEMBER = {
  ...toolDefinitions.inviteMember,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { workspaceId, inviterId, memberId, type, displayName, role } = args as {
      workspaceId: string;
      inviterId: string;
      memberId: string;
      type: 'human' | 'agent';
      displayName: string;
      role: 'admin' | 'collaborator' | 'observer';
    };

    try {
      const { inviteMember } = await import('../lib/memory/workspace-operations');
      const workspace = await inviteMember(workspaceId, inviterId, {
        workspaceId,
        memberId,
        type,
        displayName,
        role,
      });

      return JSON.stringify(
        {
          status: 'invited',
          workspaceId: workspace.workspaceId,
          memberId,
          role,
          memberCount: workspace.members.length,
        },
        null,
        2
      );
    } catch (error) {
      return `Failed to invite member: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Updates a member's role within a workspace.
 */
export const UPDATE_MEMBER_ROLE = {
  ...toolDefinitions.updateMemberRole,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { workspaceId, updaterId, targetMemberId, newRole } = args as {
      workspaceId: string;
      updaterId: string;
      targetMemberId: string;
      newRole: 'admin' | 'collaborator' | 'observer';
    };

    try {
      const { updateMemberRole } = await import('../lib/memory/workspace-operations');
      const workspace = await updateMemberRole(workspaceId, updaterId, targetMemberId, newRole);

      return JSON.stringify(
        {
          status: 'updated',
          workspaceId: workspace.workspaceId,
          memberId: targetMemberId,
          newRole,
        },
        null,
        2
      );
    } catch (error) {
      return `Failed to update member role: ${formatErrorMessage(error)}`;
    }
  },
};
