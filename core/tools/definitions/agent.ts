import { IToolDefinition } from '../../lib/types/index';

/**
 * Agent management tool definitions.
 */
export const agentTools: Record<string, IToolDefinition> = {
  dispatchTask: {
    name: 'dispatchTask',
    description: 'Dispatches a specialized task to a sub-agent.',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description:
            'The unique ID of the agent to invoke (e.g., coder, planner, or a custom agent ID).',
        },
        task: { type: 'string', description: 'The specific task for the sub-agent.' },
        metadata: {
          type: 'object',
          description: 'Optional task metadata or signals.',
        },
      },
      required: ['agentId', 'task', 'metadata'],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
  },
  manageAgentTools: {
    name: 'manageAgentTools',
    description: 'Updates the active toolset for a specific agent.',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The unique ID of the agent (e.g., main, coder).',
        },
        toolNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of tool names.',
        },
      },
      required: ['agentId', 'toolNames'],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
  },
  listAgents: {
    name: 'listAgents',
    description: 'Lists all available specialized agents in the system and their capabilities.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
  },
};
