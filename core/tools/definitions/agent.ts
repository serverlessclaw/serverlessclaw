import { IToolDefinition } from '../../lib/types/index';

const TYPE_OBJECT = 'object';
const TYPE_STRING = 'string';
const TYPE_ARRAY = 'array';

/**
 * Agent management tool definitions.
 */
export const agentTools: Record<string, IToolDefinition> = {
  dispatchTask: {
    name: 'dispatchTask',
    description: 'Dispatches a specialized task to a sub-agent.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        agentId: {
          type: TYPE_STRING,
          description:
            'The unique ID of the agent to invoke (e.g., coder, planner, or a custom agent ID).',
        },
        task: { type: TYPE_STRING, description: 'The specific task for the sub-agent.' },
      },
      required: ['agentId', 'task'],
      additionalProperties: false,
    },
  },
  manageAgentTools: {
    name: 'manageAgentTools',
    description: 'Updates the active toolset for a specific agent.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        agentId: {
          type: TYPE_STRING,
          description: 'The unique ID of the agent (e.g., main, coder).',
        },
        toolNames: {
          type: TYPE_ARRAY,
          items: { type: TYPE_STRING },
          description: 'List of tool names.',
        },
      },
      required: ['agentId', 'toolNames'],
      additionalProperties: false,
    },
  },
  getAgentRegistrySummary: {
    name: 'getAgentRegistrySummary',
    description: 'Lists all available specialized agents in the system and their capabilities.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
};
