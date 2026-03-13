import { IToolDefinition } from '../lib/types/index';

/**
 * Metadata and parameter schemas for all system tools.
 * These definitions are used by LLMs to understand how to invoke each tool.
 * All tool names follow standard JavaScript camelCase naming conventions.
 */
export const toolDefinitions: Record<string, IToolDefinition> = {
  stageChanges: {
    name: 'stageChanges',
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
      additionalProperties: false,
    },
  },
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
      },
      required: ['agentId', 'task'],
      additionalProperties: false,
    },
  },
  fileWrite: {
    name: 'fileWrite',
    description: 'Writes content to a file. Used by the Coder Agent to implement changes.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The relative path to the file.' },
        content: { type: 'string', description: 'The content to write.' },
      },
      required: ['filePath', 'content'],
      additionalProperties: false,
    },
  },
  triggerDeployment: {
    name: 'triggerDeployment',
    description: 'Triggers an autonomous self-deployment of the agent infrastructure.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'The reason for the deployment (e.g., added a new tool).',
        },
      },
      required: ['reason'],
      additionalProperties: false,
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
      additionalProperties: false,
    },
  },
  validateCode: {
    name: 'validateCode',
    description: 'Runs type checking and linting to ensure no regressions are introduced.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  checkHealth: {
    name: 'checkHealth',
    description: 'Verify the health of the deployed agent API.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The health check endpoint URL.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  triggerRollback: {
    name: 'triggerRollback',
    description: 'Trigger an emergency rollback by reverting the last commit and redeploying.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'The reason for the rollback.' },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
  getWeather: {
    name: 'getWeather',
    description: 'Get the current weather in a given location.',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'The city and state, e.g. San Francisco, CA' },
      },
      required: ['location'],
      additionalProperties: false,
    },
  },
  runTests: {
    name: 'runTests',
    description: 'Runs the project unit tests to verify changes before staging.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
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
  recallKnowledge: {
    name: 'recallKnowledge',
    description:
      "Searches the agent's long-term memory for relevant facts, lessons, or capability gaps.",
    parameters: {
      type: 'object',
      properties: {
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
      required: ['query', 'category'],
      additionalProperties: false,
    },
  },
  manageAgentTools: {
    name: 'manageAgentTools',
    description: 'Updates the active toolset for a specific agent.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The unique ID of the agent (e.g., main, coder).' },
        toolNames: { type: 'array', items: { type: 'string' }, description: 'List of tool names.' },
      },
      required: ['agentId', 'toolNames'],
      additionalProperties: false,
    },
  },
  manageGap: {
    name: 'manageGap',
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
      additionalProperties: false,
    },
  },
  reportGap: {
    name: 'reportGap',
    description: 'Records a new capability gap or system limitation into the evolution pipeline.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Detailed description of the gap or missing capability.',
        },
        impact: {
          type: 'number',
          description: 'Impact score (1-10) of this gap on system utility.',
        },
        urgency: {
          type: 'number',
          description: 'Urgency score (1-10) for addressing this gap.',
        },
        category: {
          type: 'string',
          enum: ['strategic_gap', 'tactical_lesson', 'system_knowledge'],
          description: 'The category of the insight.',
        },
      },
      required: ['content', 'impact', 'urgency', 'category'],
      additionalProperties: false,
    },
  },
  checkConfig: {
    name: 'checkConfig',
    description: 'Retrieves the current runtime configuration, including active LLM provider and model.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  fileRead: {
    name: 'fileRead',
    description: 'Reads the content of a file from the codebase.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The relative path to the file.' },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
  },
  listFiles: {
    name: 'listFiles',
    description: 'Lists files in a directory to explore the project structure.',
    parameters: {
      type: 'object',
      properties: {
        dirPath: {
          type: 'string',
          description: 'The relative path to the directory (defaults to root).',
        },
      },
      required: ['dirPath'],
      additionalProperties: false,
    },
  },
  setSystemConfig: {
    name: 'setSystemConfig',
    description: 'Updates a system-wide configuration value in the ConfigTable.',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'The configuration key (e.g. evolution_mode, deploy_limit).',
        },
        value: { type: 'any', description: 'The new value for the configuration.' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
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
  },
  discoverSkills: {
    name: 'discoverSkills',
    description: 'Searches the global Skills Marketplace for new capabilities based on a query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The functionality you are looking for.' },
        category: {
          type: 'string',
          description: 'Optional category filter (e.g., infra, build, knowledge).',
        },
      },
      required: ['query', 'category'],
      additionalProperties: false,
    },
  },
  installSkill: {
    name: 'installSkill',
    description: "Installs a new skill into the agent's current toolset.",
    parameters: {
      type: 'object',
      properties: {
        skillName: { type: 'string', description: 'The name of the skill to install.' },
      },
      required: ['skillName'],
      additionalProperties: false,
    },
  },
  sendMessage: {
    name: 'sendMessage',
    description: 'Sends a direct message to the human user in their current chat session.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The content of the message to send.',
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
  codeInterpreter: {
    name: 'code_interpreter',
    description: 'Executes Python code in a sandboxed environment (OpenAI Built-in).',
    type: 'code_interpreter',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  fileSearch: {
    name: 'file_search',
    description: 'Searches through uploaded documents (OpenAI Built-in).',
    type: 'file_search',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  fileUpload: {
    name: 'fileUpload',
    description: "Uploads a file to the agent's persistent storage.",
    parameters: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: 'The name of the file to save.' },
        content: { type: 'string', description: 'The content of the file (text or base64).' },
        encoding: {
          type: 'string',
          enum: ['text', 'base64'],
          description: 'Content encoding type.',
        },
      },
      required: ['fileName', 'content', 'encoding'],
      additionalProperties: false,
    },
  },
  fileDelete: {
    name: 'fileDelete',
    description: "Deletes a file from the agent's persistent storage.",
    parameters: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: 'The name of the file to delete.' },
      },
      required: ['fileName'],
      additionalProperties: false,
    },
  },
  listUploadedFiles: {
    name: 'listUploadedFiles',
    description: "Lists all files currently stored in the agent's persistent storage for the user.",
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
};
