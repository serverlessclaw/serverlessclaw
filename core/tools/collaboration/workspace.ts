import { collaborationSchema } from './schema';
import { formatErrorMessage } from '../../lib/utils/error';

/**
 * Creates a new workspace for multi-human multi-agent collaboration.
 */
export const createWorkspace = {
  ...collaborationSchema.createWorkspace,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { name, description, ownerId, ownerDisplayName } = args as {
      name: string;
      description?: string;
      ownerId: string;
      ownerDisplayName: string;
    };

    try {
      const { createWorkspace } = await import('../../lib/memory/workspace-operations');
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
      return JSON.stringify({
        success: false,
        error: `Failed to create workspace: ${formatErrorMessage(error)}`,
      });
    }
  },
};

/**
 * Invites a human or agent member to a workspace.
 */
export const inviteMember = {
  ...collaborationSchema.inviteMember,
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
      const { inviteMember } = await import('../../lib/memory/workspace-operations');
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
      return JSON.stringify({
        success: false,
        error: `Failed to invite member: ${formatErrorMessage(error)}`,
      });
    }
  },
};

/**
 * Updates a member's role within a workspace.
 */
export const updateMemberRole = {
  ...collaborationSchema.updateMemberRole,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { workspaceId, updaterId, targetMemberId, newRole } = args as {
      workspaceId: string;
      updaterId: string;
      targetMemberId: string;
      newRole: 'admin' | 'collaborator' | 'observer';
    };

    try {
      const { updateMemberRole } = await import('../../lib/memory/workspace-operations');
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
      return JSON.stringify({
        success: false,
        error: `Failed to update member role: ${formatErrorMessage(error)}`,
      });
    }
  },
};

/**
 * Removes a member from a workspace.
 */
export const removeMember = {
  ...collaborationSchema.removeMember,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { workspaceId, removerId, targetMemberId } = args as {
      workspaceId: string;
      removerId: string;
      targetMemberId: string;
    };

    try {
      const { removeMember } = await import('../../lib/memory/workspace-operations');
      const workspace = await removeMember(workspaceId, removerId, targetMemberId);

      return JSON.stringify(
        {
          status: 'removed',
          workspaceId: workspace.workspaceId,
          memberId: targetMemberId,
          memberCount: workspace.members.length,
        },
        null,
        2
      );
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: `Failed to remove member: ${formatErrorMessage(error)}`,
      });
    }
  },
};

/**
 * Retrieves workspace details.
 */
export const getWorkspace = {
  ...collaborationSchema.getWorkspace,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { workspaceId } = args as { workspaceId: string };

    try {
      const { getWorkspace } = await import('../../lib/memory/workspace-operations');
      const workspace = await getWorkspace(workspaceId);

      if (!workspace) {
        return JSON.stringify({ error: 'Workspace not found' });
      }

      return JSON.stringify(
        {
          workspaceId: workspace.workspaceId,
          name: workspace.name,
          description: workspace.description,
          ownerId: workspace.ownerId,
          memberCount: workspace.members.length,
          members: workspace.members.map((m) => ({
            memberId: m.memberId,
            type: m.type,
            displayName: m.displayName,
            role: m.role,
            active: m.active,
          })),
          status: workspace.status,
        },
        null,
        2
      );
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: `Failed to get workspace: ${formatErrorMessage(error)}`,
      });
    }
  },
};

/**
 * Lists all workspace IDs.
 */
export const listWorkspaces = {
  ...collaborationSchema.listWorkspaces,
  execute: async (): Promise<string> => {
    try {
      const { listWorkspaceIds } = await import('../../lib/memory/workspace-operations');
      const ids = await listWorkspaceIds();

      return JSON.stringify({ workspaceIds: ids, count: ids.length }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: `Failed to list workspaces: ${formatErrorMessage(error)}`,
      });
    }
  },
};
