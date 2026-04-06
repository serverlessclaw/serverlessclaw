import { IToolDefinition, ToolType } from '../../lib/types/index';
import { LLMProvider } from '../../lib/types/llm';

/**
 * System Domain Tool Definitions
 */

export const systemSchema: Record<string, IToolDefinition> = {
  // File System (from fs.ts)
  runShellCommand: {
    type: ToolType.FUNCTION,
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
    type: ToolType.FUNCTION,
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
    type: ToolType.FUNCTION,
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
    type: ToolType.FUNCTION,
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
    type: ToolType.FUNCTION,
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
    type: ToolType.FUNCTION,
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
    type: ToolType.FUNCTION,
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
    type: ToolType.FUNCTION,
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
    type: ToolType.FUNCTION,
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

  // UI & Interaction (from ui.ts)
  renderComponent: {
    type: ToolType.FUNCTION,
    name: 'renderComponent',
    description:
      'Renders a specialized UI component in the dashboard to provide structured information or enable interactive operations.',
    parameters: {
      type: 'object',
      properties: {
        componentType: {
          type: 'string',
          description:
            'The type of UI component to render (e.g., "operation-card", "status-flow", "resource-preview").',
        },
        props: {
          type: 'object',
          description: 'The properties for the UI component.',
        },
        actions: {
          type: 'array',
          description: 'Optional list of interactive actions available for the component.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique ID for the action.' },
              label: { type: 'string', description: 'The text displayed on the action button.' },
              type: { type: 'string', enum: ['primary', 'secondary', 'danger'] },
              payload: {
                type: 'object',
                description: 'Optional data to send back when the action is triggered.',
              },
            },
            required: ['id', 'label'],
          },
        },
        title: { type: 'string', description: 'An optional title for the component.' },
        persistent: {
          type: 'boolean',
          description:
            'Whether the component should be pinned to the persistent workspace/artifact panel.',
        },
      },
      required: ['componentType', 'props'],
      additionalProperties: false,
    },
  },
  navigateTo: {
    type: ToolType.FUNCTION,
    name: 'navigateTo',
    description:
      'Navigates the user to a specific path in the dashboard. STRICTLY restricted to SuperClaw.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The relative path to navigate to (e.g., "/traces", "/topology").',
        },
        params: {
          type: 'object',
          description: 'Optional query parameters for the target route.',
        },
        mode: {
          type: 'string',
          enum: ['auto', 'hitl'],
          description:
            'Navigation mode. "auto" navigates immediately (use sparingly). "hitl" (Human-in-the-Loop) shows a navigation button for the user to click.',
        },
      },
      required: ['path', 'mode'],
      additionalProperties: false,
    },
  },
  uiAction: {
    type: ToolType.FUNCTION,
    name: 'uiAction',
    description: 'Triggers a specific UI event or state change in the current dashboard view.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open_modal', 'close_modal', 'focus_resource', 'toggle_sidebar'],
          description: 'The type of UI action to perform.',
        },
        target: {
          type: 'string',
          description: 'The ID or selector of the target element or resource.',
        },
        payload: {
          type: 'object',
          description: 'Optional data for the UI action.',
        },
      },
      required: ['action', 'target'],
      additionalProperties: false,
    },
  },
};
