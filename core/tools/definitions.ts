import { IToolDefinition } from '../lib/types/index';

/**
 * Metadata and parameter schemas for all system tools.
 * These definitions are used by LLMs to understand how to invoke each tool.
 */
export const toolDefinitions: Record<string, IToolDefinition> = {
  stage_changes: {
    name: 'stage_changes',
    description: 'Stages modified files to S3 for persistent deployment.',
    parameters: {
      type: 'object',
      properties: {
        modifiedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of relative file paths that were modified.',
        },
      },
      required: ['modifiedFiles'],
    },
  },
  dispatch_task: {
    name: 'dispatch_task',
    description: 'Dispatches a specialized task to a sub-agent.',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description:
            'The unique ID of the agent to invoke (e.g., coder, planner, or a custom agent ID).',
        },
        userId: { type: 'string', description: 'The user ID context for the task.' },
        task: { type: 'string', description: 'The specific task for the sub-agent.' },
      },
      required: ['agentId', 'userId', 'task'],
    },
  },
  file_write: {
    name: 'file_write',
    description: 'Writes content to a file. Used by the Coder Agent to implement changes.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The relative path to the file.' },
        content: { type: 'string', description: 'The content to write.' },
      },
      required: ['filePath', 'content'],
    },
  },
  trigger_deployment: {
    name: 'trigger_deployment',
    description: 'Triggers an autonomous self-deployment of the agent infrastructure.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'The reason for the deployment (e.g., added a new tool).',
        },
        userId: {
          type: 'string',
          description: 'The user ID context for the deployment.',
        },
      },
      required: ['reason', 'userId'],
    },
  },
  calculator: {
    name: 'calculator',
    description: 'Evaluates mathematical expressions.',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'The expression to evaluate.' },
      },
      required: ['expression'],
    },
  },
  validate_code: {
    name: 'validate_code',
    description: 'Runs type checking and linting to ensure no regressions are introduced.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  check_health: {
    name: 'check_health',
    description: 'Verify the health of the deployed agent API.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The health check endpoint URL.' },
      },
      required: ['url'],
    },
  },
  trigger_rollback: {
    name: 'trigger_rollback',
    description: 'Trigger an emergency rollback by reverting the last commit and redeploying.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'The reason for the rollback.' },
      },
      required: ['reason'],
    },
  },
  get_weather: {
    name: 'get_weather',
    description: 'Get the current weather in a given location.',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'The city and state, e.g. San Francisco, CA' },
      },
      required: ['location'],
    },
  },
  run_tests: {
    name: 'run_tests',
    description: 'Runs the project unit tests to verify changes before staging.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  run_shell_command: {
    name: 'run_shell_command',
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
      required: ['command'],
    },
  },
  switch_model: {
    name: 'switch_model',
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
    },
  },
  recall_knowledge: {
    name: 'recall_knowledge',
    description:
      "Searches the agent's long-term memory for relevant facts, lessons, or capability gaps.",
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The user ID context.' },
        query: {
          type: 'string',
          description: 'The search query or keyword (use "*" for all recent).',
        },
        category: {
          type: 'string',
          enum: ['user_preference', 'tactical_lesson', 'strategic_gap', 'system_knowledge'],
          description: 'Optional category filter.',
        },
      },
      required: ['userId', 'query'],
    },
  },
  manage_agent_tools: {
    name: 'manage_agent_tools',
    description: 'Updates the active toolset for a specific agent.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The unique ID of the agent (e.g., main, coder).' },
        toolNames: { type: 'array', items: { type: 'string' }, description: 'List of tool names.' },
      },
      required: ['agentId', 'toolNames'],
    },
  },
  manage_gap: {
    name: 'manage_gap',
    description: 'Updates the status of a capability gap.',
    parameters: {
      type: 'object',
      properties: {
        gapId: { type: 'string', description: 'The ID of the gap (timestamp part).' },
        status: {
          type: 'string',
          enum: ['OPEN', 'PLANNED', 'PROGRESS', 'DEPLOYED', 'DONE', 'FAILED', 'ARCHIVED'],
          description: 'The new status for the gap.',
        },
      },
      required: ['gapId', 'status'],
    },
  },
  file_read: {
    name: 'file_read',
    description: 'Reads the content of a file from the codebase.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The relative path to the file.' },
      },
      required: ['filePath'],
    },
  },
  list_files: {
    name: 'list_files',
    description: 'Lists files in a directory to explore the project structure.',
    parameters: {
      type: 'object',
      properties: {
        dirPath: {
          type: 'string',
          description: 'The relative path to the directory (defaults to root).',
        },
      },
    },
  },
};
