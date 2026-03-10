export const tools = {
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
    description: 'Dispatches a specialized task to a sub-agent (e.g., coder).',
    parameters: {
      type: 'object',
      properties: {
        agentType: {
          type: 'string',
          enum: ['coder'],
          description: 'The type of sub-agent to invoke.',
        },
        userId: { type: 'string', description: 'The user ID context for the task.' },
        task: { type: 'string', description: 'The specific task for the sub-agent.' },
      },
      required: ['agentType', 'userId', 'task'],
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
        reason: { type: 'string', description: 'The reason for the deployment.' },
        userId: { type: 'string', description: 'The user ID context for the deployment.' },
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
  manage_agent_tools: {
    name: 'manage_agent_tools',
    description: 'Updates the active toolset for a specific agent.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The type of agent (main, coder, planner, events)' },
        toolNames: { type: 'array', items: { type: 'string' }, description: 'List of tool names' },
      },
      required: ['agentId', 'toolNames'],
    },
  },
  recall_knowledge: {
    name: 'recall_knowledge',
    description: 'Retrieves distilled facts/lessons from memory.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  run_tests: {
    name: 'run_tests',
    description: 'Executes project unit tests (vitest).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  switch_model: {
    name: 'switch_model',
    description: 'Updates active provider/model in DynamoDB (Hot Config).',
    parameters: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['openai', 'bedrock', 'openrouter'] },
        model: { type: 'string' },
      },
      required: ['provider', 'model'],
    },
  },
};
