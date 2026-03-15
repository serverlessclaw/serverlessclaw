import { IToolDefinition } from '../../lib/types/index';

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
          enum: ['openai', 'bedrock', 'openrouter'],
          description: 'The LLM provider to switch to.',
        },
        model: {
          type: 'string',
          description:
            'The specific model ID to use (e.g. gpt-5-mini, google/gemini-3-flash-preview).',
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
};
