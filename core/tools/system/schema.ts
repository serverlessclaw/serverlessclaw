import { IToolDefinition } from '../../lib/types/index';
import { LLMProvider } from '../../lib/types/llm';

/**
 * System Domain Tool Definitions
 */

export const systemSchema: Record<string, IToolDefinition> = {
  // File System (from fs.ts)
  runShellCommand: {
    name: 'runShellCommand',
    description: 'Executes a shell command in the agent environment.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        dir_path: { type: 'string', description: 'Relative directory path.' },
      },
      required: ['command', 'dir_path'],
      additionalProperties: false,
    },
  },
  runTests: {
    name: 'runTests',
    description: 'Runs the project unit tests to verify changes.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },

  // Git (from git.ts)
  triggerTrunkSync: {
    name: 'triggerTrunkSync',
    description: 'Triggers a CI/CD job to sync with the origin main branch.',
    parameters: {
      type: 'object',
      properties: {
        commitMessage: { type: 'string', description: 'Commit message for the sync.' },
      },
      required: ['commitMessage'],
      additionalProperties: false,
    },
  },

  // Health (from health.ts / health-check.ts)
  checkHealth: {
    name: 'checkHealth',
    description: 'Performs a comprehensive system-wide health and connectivity check.',
    parameters: {
      type: 'object',
      properties: {
        verbose: { type: 'boolean', description: 'Detailed results.' },
      },
      additionalProperties: false,
    },
  },
  runCognitiveHealthCheck: {
    name: 'runCognitiveHealthCheck',
    description:
      'Runs a deep cognitive health check on agents, analyzing reasoning quality, memory health, and detecting anomalies.',
    parameters: {
      type: 'object',
      properties: {
        agentIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of specific agent IDs to check. If not provided, checks all backbone agents.',
        },
        verbose: {
          type: 'boolean',
          description: 'Include detailed metrics and anomaly information.',
        },
      },
      additionalProperties: false,
    },
  },

  // Debug (from debug.ts)
  debugAgent: {
    name: 'debugAgent',
    description: 'Enables advanced debugging and logging for a specific agent.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        level: { type: 'string', enum: ['info', 'debug', 'trace'] },
      },
      required: ['agentId', 'level'],
      additionalProperties: false,
    },
  },

  // Validation (from validation.ts)
  validateCode: {
    name: 'validateCode',
    description: 'Runs type checking and linting.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },

  // System Config (moved from main index / system index)
  switchModel: {
    name: 'switchModel',
    description: 'Switch the active LLM provider and model at runtime.',
    parameters: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: [
            LLMProvider.OPENAI,
            LLMProvider.BEDROCK,
            LLMProvider.OPENROUTER,
            LLMProvider.MINIMAX,
          ],
        },
        model: { type: 'string' },
      },
      required: ['provider', 'model'],
      additionalProperties: false,
    },
    connectionProfile: ['system'],
  },
  checkReputation: {
    name: 'checkReputation',
    description:
      "Retrieves an agent's rolling 7-day performance reputation metrics (success rate, latency, score).",
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The unique ID of the agent to check (e.g., coder, planner).',
        },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
    connectionProfile: ['memory'],
  },
};
