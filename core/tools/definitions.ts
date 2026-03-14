import { IToolDefinition } from '../lib/types/index';

const TYPE_OBJECT = 'object';
const TYPE_STRING = 'string';
const TYPE_ARRAY = 'array';
const TYPE_NUMBER = 'number';

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
      type: TYPE_OBJECT,
      properties: {
        modifiedFiles: {
          type: TYPE_ARRAY,
          items: { type: TYPE_STRING },
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
  triggerDeployment: {
    name: 'triggerDeployment',
    description: 'Triggers an autonomous self-deployment of the agent infrastructure.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        reason: {
          type: TYPE_STRING,
          description: 'The reason for the deployment (e.g., added a new tool).',
        },
        gapIds: {
          type: TYPE_ARRAY,
          items: { type: TYPE_STRING },
          description: 'Optional list of gap IDs to associate with this build.',
        },
      },
      required: ['reason', 'gapIds'],
      additionalProperties: false,
    },
  },
  validateCode: {
    name: 'validateCode',
    description: 'Runs type checking and linting to ensure no regressions are introduced.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  checkHealth: {
    name: 'checkHealth',
    description: 'Verify the health of the deployed agent API.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        url: { type: TYPE_STRING, description: 'The health check endpoint URL.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  triggerRollback: {
    name: 'triggerRollback',
    description: 'Trigger an emergency rollback by reverting the last commit and redeploying.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        reason: { type: TYPE_STRING, description: 'The reason for the rollback.' },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
  runTests: {
    name: 'runTests',
    description: 'Runs the project unit tests to verify changes before staging.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  runShellCommand: {
    name: 'runShellCommand',
    description: 'Executes a shell command in the agent environment.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        command: { type: TYPE_STRING, description: 'The shell command to execute.' },
        dir_path: {
          type: TYPE_STRING,
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
      type: TYPE_OBJECT,
      properties: {
        provider: {
          type: TYPE_STRING,
          enum: ['openai', 'bedrock', 'openrouter'],
          description: 'The LLM provider to switch to.',
        },
        model: {
          type: TYPE_STRING,
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
      type: TYPE_OBJECT,
      properties: {
        query: {
          type: TYPE_STRING,
          description: 'The search query or keyword (use "*" for all recent).',
        },
        category: {
          type: TYPE_STRING,
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
  manageGap: {
    name: 'manageGap',
    description: 'Updates the status of a capability gap.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        gapId: { type: TYPE_STRING, description: 'The ID of the gap (timestamp part).' },
        status: {
          type: TYPE_STRING,
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
      type: TYPE_OBJECT,
      properties: {
        content: {
          type: TYPE_STRING,
          description: 'Detailed description of the gap or missing capability.',
        },
        impact: {
          type: TYPE_NUMBER,
          description: 'Impact score (1-10) of this gap on system utility.',
        },
        urgency: {
          type: TYPE_NUMBER,
          description: 'Urgency score (1-10) for addressing this gap.',
        },
        category: {
          type: TYPE_STRING,
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
    description:
      'Retrieves the current runtime configuration, including active LLM provider and model.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  setSystemConfig: {
    name: 'setSystemConfig',
    description: 'Updates a system-wide configuration value in the ConfigTable.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        key: {
          type: TYPE_STRING,
          description: 'The configuration key (e.g. evolution_mode, deploy_limit).',
        },
        value: {
          type: TYPE_STRING,
          description: 'The new value for the configuration (JSON stringified if object).',
        },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
  },
  registerMCPServer: {
    name: 'registerMCPServer',
    description: 'Registers a new Model Context Protocol (MCP) server for dynamic tool discovery.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        serverName: {
          type: TYPE_STRING,
          description: 'A unique name for the server (e.g., git, search).',
        },
        command: {
          type: TYPE_STRING,
          description: 'The command to run the server (e.g., npx @mcp/server-git).',
        },
        env: {
          type: TYPE_STRING,
          description: 'Optional environment variables for the server (JSON stringified object).',
        },
      },
      required: ['serverName', 'command', 'env'],
      additionalProperties: false,
    },
  },
  unregisterMCPServer: {
    name: 'unregisterMCPServer',
    description: 'Removes an MCP server and all its associated tools from the system.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        serverName: {
          type: TYPE_STRING,
          description: 'The name of the MCP server to remove.',
        },
      },
      required: ['serverName'],
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
  inspectTrace: {
    name: 'inspectTrace',
    description:
      'Retrieves the full mechanical monologue (tool calls, intermediate reasoning) for a specific trace ID.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        traceId: { type: TYPE_STRING, description: 'The unique ID of the trace to inspect.' },
      },
      required: ['traceId'],
      additionalProperties: false,
    },
  },
  discoverSkills: {
    name: 'discoverSkills',
    description: 'Searches the global Skills Marketplace for new capabilities based on a query.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        query: { type: TYPE_STRING, description: 'Functional search query.' },
        category: {
          type: TYPE_STRING,
          description: 'Optional category filter like infra, build, knowledge.',
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
      type: TYPE_OBJECT,
      properties: {
        skillName: { type: TYPE_STRING, description: 'The name of the skill to install.' },
      },
      required: ['skillName'],
      additionalProperties: false,
    },
  },
  saveMemory: {
    name: 'saveMemory',
    description: 'Directly saves a new fact or user preference into the system memory.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        content: { type: TYPE_STRING, description: 'The fact or preference to save.' },
        category: {
          type: TYPE_STRING,
          enum: ['user_preference', 'system_knowledge'], // Aligned with InsightCategory enum
          description: 'The category of the knowledge.',
        },
      },
      required: ['content', 'category'],
      additionalProperties: false,
    },
  },
  seekClarification: {
    name: 'seekClarification',
    description: 'Pauses the current agent and requests clarification from the initiator.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        question: { type: TYPE_STRING, description: 'The specific question for the initiator.' },
        originalTask: {
          type: TYPE_STRING,
          description: 'The task you were working on when you needed clarification.',
        },
      },
      required: ['question', 'originalTask'],
      additionalProperties: false,
    },
  },
  provideClarification: {
    name: 'provideClarification',
    description: 'Provides an answer to a clarification request, resuming the target agent.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        agentId: {
          type: TYPE_STRING,
          description: 'The ID of the agent that requested clarification.',
        },
        answer: { type: TYPE_STRING, description: 'The answer to the question.' },
        originalTask: {
          type: TYPE_STRING,
          description: 'The task the agent was working on.',
        },
      },
      required: ['agentId', 'answer', 'originalTask'],
      additionalProperties: false,
    },
  },
  // REMOVED: saveKnowledge,
};
