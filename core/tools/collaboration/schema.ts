import { z } from 'zod';
import { IToolDefinition, ToolType } from '../../lib/types/index';

/**
 * Collaboration Domain Tool Definitions
 */

export const collaborationSchema: Record<string, IToolDefinition> = {
  // Collaboration Sessions (from collaboration.ts)
  createCollaboration: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'createCollaboration',
    description:
      'Creates a new collaboration session for multi-party agent-agent or agent-human collaboration. Returns a collaborationId that can be used to share context.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the collaboration' },
        description: { type: 'string', description: 'Optional description' },
        participants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['agent', 'human'] },
              id: { type: 'string' },
              role: { type: 'string', enum: ['editor', 'viewer'] },
            },
            required: ['type', 'id', 'role'],
            additionalProperties: false,
          },
        },
        workspaceId: { type: 'string', description: 'Optional workspace ID to auto-add members.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    connectionProfile: ['memory'],
  },
  joinCollaboration: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'joinCollaboration',
    description: 'Joins an existing collaboration to access its shared session context.',
    parameters: {
      type: 'object',
      properties: {
        collaborationId: { type: 'string', description: 'ID of the collaboration to join' },
      },
      required: ['collaborationId'],
      additionalProperties: false,
    },
    connectionProfile: ['memory'],
  },
  getCollaborationContext: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'getCollaborationContext',
    description: 'Gets the shared session context (conversation history) for a collaboration.',
    parameters: {
      type: 'object',
      properties: {
        collaborationId: { type: 'string', description: 'ID of the collaboration' },
        limit: { type: 'number', description: 'Max messages (default: 50)' },
      },
      required: ['collaborationId'],
      additionalProperties: false,
    },
    connectionProfile: ['memory'],
  },
  writeToCollaboration: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'writeToCollaboration',
    description: 'Writes a message to the shared collaboration session.',
    parameters: {
      type: 'object',
      properties: {
        collaborationId: { type: 'string', description: 'ID of the collaboration' },
        content: { type: 'string', description: 'Message content' },
        role: { type: 'string', enum: ['user', 'assistant'] },
      },
      required: ['collaborationId', 'content'],
      additionalProperties: false,
    },
    connectionProfile: ['memory'],
  },
  listMyCollaborations: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'listMyCollaborations',
    description: 'Lists all collaborations that the current agent is a participant of.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    connectionProfile: ['memory'],
  },
  closeCollaboration: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'closeCollaboration',
    description: 'Closes a collaboration session, marking it as finished.',
    parameters: {
      type: 'object',
      properties: {
        collaborationId: { type: 'string', description: 'ID of the collaboration to close' },
      },
      required: ['collaborationId'],
      additionalProperties: false,
    },
    connectionProfile: ['memory'],
  },

  // Clarification (from clarification.ts)
  seekClarification: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'seekClarification',
    description: 'Pauses the current agent and requests clarification from the initiator.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The specific question for the initiator.' },
        originalTask: { type: 'string', description: 'The task you were working on.' },
      },
      required: ['question', 'originalTask'],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
  },
  provideClarification: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'provideClarification',
    description: 'Provides an answer to a clarification request, resuming the target agent.',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The ID of the agent that requested clarification.',
        },
        answer: { type: 'string', description: 'The answer to the question.' },
        originalTask: { type: 'string', description: 'The task the agent was working on.' },
      },
      required: ['agentId', 'answer', 'originalTask'],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
  },

  // Workspace (from system.ts)
  createWorkspace: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'createWorkspace',
    description: 'Creates a new workspace for multi-human multi-agent collaboration.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable workspace name.' },
        description: { type: 'string', description: 'Optional workspace description.' },
        ownerId: { type: 'string', description: 'The human member ID who will own the workspace.' },
        ownerDisplayName: { type: 'string', description: 'Display name for the owner.' },
      },
      required: ['name', 'ownerId', 'ownerDisplayName'],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
  inviteMember: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'inviteMember',
    description: 'Invites a human or agent member to an existing workspace.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace to invite to.' },
        inviterId: { type: 'string', description: 'The member ID performing the invite.' },
        memberId: { type: 'string', description: 'The new member ID.' },
        type: { type: 'string', enum: ['human', 'agent'], description: 'Member type.' },
        displayName: { type: 'string', description: 'Display name for the new member.' },
        role: {
          type: 'string',
          enum: ['admin', 'collaborator', 'observer'],
          description: 'Initial role.',
        },
      },
      required: ['workspaceId', 'inviterId', 'memberId', 'type', 'displayName', 'role'],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
  updateMemberRole: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'updateMemberRole',
    description: "Updates a member's role within a workspace.",
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID.' },
        updaterId: { type: 'string', description: 'The member performing the update.' },
        targetMemberId: { type: 'string', description: 'The member whose role to change.' },
        newRole: {
          type: 'string',
          enum: ['admin', 'collaborator', 'observer'],
          description: 'The new role.',
        },
      },
      required: ['workspaceId', 'updaterId', 'targetMemberId', 'newRole'],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
  removeMember: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'removeMember',
    description: 'Removes a member from a workspace.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID.' },
        removerId: { type: 'string', description: 'The member performing the removal.' },
        targetMemberId: { type: 'string', description: 'The member to remove.' },
      },
      required: ['workspaceId', 'removerId', 'targetMemberId'],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
  getWorkspace: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'getWorkspace',
    description: 'Retrieves workspace details including all members and their roles.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID to retrieve.' },
      },
      required: ['workspaceId'],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
  listWorkspaces: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'listWorkspaces',
    description: 'Lists all workspace IDs in the system.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },

  // Messaging (from messaging.ts)
  broadcastMessage: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'broadcastMessage',
    description: 'Broadcasts a message to all active agents or sessions.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message content' },
        category: { type: 'string', description: 'Optional category' },
      },
      required: ['message'],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
  },
  sendMessage: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'sendMessage',
    description: 'Sends a direct message to a specific user on a specific session.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message content' },
        sessionId: { type: 'string', description: 'Target session ID' },
        agentName: { type: 'string', description: 'Name of the sender agent' },
        traceId: { type: 'string', description: 'Optional trace ID' },
      },
      required: ['message'],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
  },
  getMessages: {
    type: ToolType.FUNCTION,
    argSchema: z.any(),
    requiresApproval: false,
    requiredPermissions: [],
    name: 'getMessages',
    description: 'Retrieves messages from a specific conversation or session.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        limit: { type: 'number', description: 'Max messages' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
  },
};
