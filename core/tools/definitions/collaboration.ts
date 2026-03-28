import { IToolDefinition } from '../../lib/types/index';

/**
 * Collaboration tool definitions for multi-party agent-agent and agent-human collaboration.
 */
export const collaborationTools: Record<string, IToolDefinition> = {
  createCollaboration: {
    name: 'createCollaboration',
    description:
      'Creates a new collaboration session for multi-party agent-agent or agent-human collaboration. Returns a collaborationId that can be used to share context.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the collaboration',
        },
        description: {
          type: 'string',
          description: 'Optional description of the collaboration purpose',
        },
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
          },
          description: 'Initial participants to add (owner is automatically added)',
        },
        ttlDays: {
          type: 'number',
          description: 'Optional TTL in days for temporary collaborations',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorization',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    connectionProfile: ['memory'],
  },

  joinCollaboration: {
    name: 'joinCollaboration',
    description: 'Joins an existing collaboration to access its shared session context.',
    parameters: {
      type: 'object',
      properties: {
        collaborationId: {
          type: 'string',
          description: 'ID of the collaboration to join',
        },
      },
      required: ['collaborationId'],
      additionalProperties: false,
    },
    connectionProfile: ['memory'],
  },

  getCollaborationContext: {
    name: 'getCollaborationContext',
    description: 'Gets the shared session context (conversation history) for a collaboration.',
    parameters: {
      type: 'object',
      properties: {
        collaborationId: {
          type: 'string',
          description: 'ID of the collaboration',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages to retrieve (default: 50)',
        },
      },
      required: ['collaborationId'],
      additionalProperties: false,
    },
    connectionProfile: ['memory'],
  },

  writeToCollaboration: {
    name: 'writeToCollaboration',
    description:
      'Writes a message to the shared collaboration session. All participants will see this message.',
    parameters: {
      type: 'object',
      properties: {
        collaborationId: {
          type: 'string',
          description: 'ID of the collaboration',
        },
        content: {
          type: 'string',
          description: 'Message content to write',
        },
        role: {
          type: 'string',
          enum: ['user', 'assistant'],
          description: 'Message role (default: assistant for agents)',
        },
      },
      required: ['collaborationId', 'content'],
      additionalProperties: false,
    },
    connectionProfile: ['memory'],
  },

  listMyCollaborations: {
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
    name: 'closeCollaboration',
    description: 'Closes a collaboration session, marking it as finished.',
    parameters: {
      type: 'object',
      properties: {
        collaborationId: {
          type: 'string',
          description: 'ID of the collaboration to close',
        },
      },
      required: ['collaborationId'],
      additionalProperties: false,
    },
    connectionProfile: ['memory'],
  },
};
