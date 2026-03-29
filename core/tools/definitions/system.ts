import { IToolDefinition } from '../../lib/types/index';
import { LLMProvider } from '../../lib/types/llm';

/**
 * System utility tool definitions.
 */
export const systemTools: Record<string, IToolDefinition> = {
  runShellCommand: {
    name: 'runShellCommand',
    description: 'Executes a shell command in the agent environment.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        dir_path: {
          type: 'string',
          description: 'The directory path to run the command in (relative to project root).',
        },
      },
      required: ['command', 'dir_path'],
      additionalProperties: false,
    },
  },
  switchModel: {
    name: 'switchModel',
    description: 'Switch the active LLM provider and model at runtime.',
    parameters: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: [LLMProvider.OPENAI, LLMProvider.BEDROCK, LLMProvider.OPENROUTER],
          description: 'The LLM provider to switch to.',
        },
        model: {
          type: 'string',
          description:
            'The specific model ID to use (e.g. gpt-5.4-mini, google/gemini-3-flash-preview).',
        },
      },
      required: ['provider', 'model'],
      additionalProperties: false,
    },
  },
  inspectTrace: {
    name: 'inspectTrace',
    description:
      'Retrieves the full mechanical monologue (tool calls, intermediate reasoning) for a specific trace ID.',
    parameters: {
      type: 'object',
      properties: {
        traceId: { type: 'string', description: 'The unique ID of the trace to inspect.' },
      },
      required: ['traceId'],
      additionalProperties: false,
    },
    connectionProfile: ['trace'],
  },
  inspectTopology: {
    name: 'inspectTopology',
    description:
      'Returns a structured map of the entire system (agents, infrastructure, and connections). Use this to understand how components are linked.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
  forceReleaseLock: {
    name: 'forceReleaseLock',
    description:
      'Forces release of a distributed session lock. Use with caution: releasing an active lock may cause state corruption.',
    parameters: {
      type: 'object',
      properties: {
        lockId: {
          type: 'string',
          description: 'The lock partition key to release (e.g., "LOCK#session-abc").',
        },
      },
      required: ['lockId'],
      additionalProperties: false,
    },
    requiresApproval: true,
    connectionProfile: ['memory'],
  },
  createWorkspace: {
    name: 'createWorkspace',
    description:
      'Creates a new workspace for multi-human multi-agent collaboration. A workspace is a shared context with role-based access control.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable workspace name.' },
        description: { type: 'string', description: 'Optional workspace description.' },
        ownerId: {
          type: 'string',
          description: 'The human member ID who will own the workspace.',
        },
        ownerDisplayName: { type: 'string', description: 'Display name for the owner.' },
      },
      required: ['name', 'ownerId', 'ownerDisplayName'],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
  inviteMember: {
    name: 'inviteMember',
    description:
      'Invites a human or agent member to an existing workspace. Requires admin or owner role.',
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
          description: 'Initial role for the new member.',
        },
      },
      required: ['workspaceId', 'inviterId', 'memberId', 'type', 'displayName', 'role'],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
  updateMemberRole: {
    name: 'updateMemberRole',
    description: "Updates a member's role within a workspace. Requires admin or owner role.",
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID.' },
        updaterId: { type: 'string', description: 'The member performing the update.' },
        targetMemberId: { type: 'string', description: 'The member whose role to change.' },
        newRole: {
          type: 'string',
          enum: ['admin', 'collaborator', 'observer'],
          description: 'The new role to assign.',
        },
      },
      required: ['workspaceId', 'updaterId', 'targetMemberId', 'newRole'],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
};
