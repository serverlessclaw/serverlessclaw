import { z } from 'zod';
import { IToolDefinition, LLMProvider } from '../../lib/types/index';

/**
 * Knowledge Domain Tool Definitions
 */

export const knowledgeSchema: Record<string, IToolDefinition> = {
  // Agent Management (from agent.ts)
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
  createAgent: {
    name: 'createAgent',
    description: 'Registers a new agent in the system. Cannot override backbone agents.',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Unique identifier for the new agent (lowercase, hyphenated).',
        },
        name: { type: 'string', description: 'Display name for the agent.' },
        systemPrompt: {
          type: 'string',
          description: 'The system prompt defining the agent persona and behavior.',
        },
        provider: {
          type: 'string',
          enum: [
            LLMProvider.OPENAI,
            LLMProvider.BEDROCK,
            LLMProvider.OPENROUTER,
            LLMProvider.MINIMAX,
          ],
          description: 'LLM provider for this agent.',
        },
        model: { type: 'string', description: 'Model ID to use (e.g., gpt-5.4-mini).' },
        enabled: {
          type: 'boolean',
          description: 'Whether the agent is active immediately.',
        },
      },
      required: ['agentId', 'name', 'systemPrompt'],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
  deleteAgent: {
    name: 'deleteAgent',
    description:
      'Removes a non-backbone agent from the registry. Backbone agents cannot be deleted.',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The ID of the agent to remove.',
        },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
  syncAgentRegistry: {
    name: 'syncAgentRegistry',
    description:
      'Synchronizes the agent registry by refreshing backbone configs and discovering topology.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },

  // Storage & Memory (from knowledge.ts)
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
          enum: [
            'user_preference',
            'tactical_lesson',
            'strategic_gap',
            'system_knowledge',
            'architecture',
            'security',
          ],
          description: 'Optional category filter.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags to filter the search.',
        },
        minImpact: {
          type: 'number',
          description: 'Minimum impact score (0-10) filter.',
        },
        minConfidence: {
          type: 'number',
          description: 'Minimum confidence score (0-10) filter.',
        },
        orgId: {
          type: 'string',
          description: 'Optional organization ID to scope the search.',
        },
      },
      required: ['query', 'category'],
      additionalProperties: false,
    },
    argSchema: z.object({
      query: z.string(),
      category: z.enum([
        'user_preference',
        'tactical_lesson',
        'strategic_gap',
        'system_knowledge',
        'architecture',
        'security',
      ]),
      tags: z.array(z.string()).optional(),
      minImpact: z.number().optional(),
      minConfidence: z.number().optional(),
      userId: z.string(),
      orgId: z.string().optional(),
    }),
    connectionProfile: ['memory'],
  },
  saveMemory: {
    name: 'saveMemory',
    description:
      'Saves project knowledge (facts, conclusions, user preferences) into the system memory.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The knowledge, fact, or preference to save.' },
        category: {
          type: 'string',
          enum: [
            'user_preference',
            'system_knowledge',
            'tactical_lesson',
            'architecture',
            'security',
          ],
          description: 'The category of the knowledge.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for the memory.',
        },
        orgId: {
          type: 'string',
          description: 'Optional organization ID to scope the knowledge.',
        },
      },
      required: ['content', 'category'],
      additionalProperties: false,
    },
    argSchema: z.object({
      content: z.string(),
      category: z.enum([
        'user_preference',
        'system_knowledge',
        'tactical_lesson',
        'architecture',
        'security',
      ]),
      tags: z.array(z.string()).optional(),
      userId: z.string(),
      orgId: z.string().optional(),
    }),
    connectionProfile: ['memory'],
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
          enum: [
            'strategic_gap',
            'tactical_lesson',
            'system_knowledge',
            'architecture',
            'security',
          ],
          description: 'The category of the insight.',
        },
      },
      required: ['content', 'impact', 'urgency', 'category'],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
  manageGap: {
    name: 'manageGap',
    description: 'Updates or lists capability gaps in the system.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['update', 'list'],
          description: 'The action to perform: "update" (default) or "list".',
        },
        gapId: { type: 'string', description: 'The ID of the gap (required for "update").' },
        status: {
          type: 'string',
          enum: ['OPEN', 'PLANNED', 'PROGRESS', 'DEPLOYED', 'DONE', 'FAILED', 'ARCHIVED'],
          description: 'The new status for the gap (required for "update").',
        },
      },
      required: [],
      additionalProperties: false,
    },
    connectionProfile: ['config'],
  },
  pruneMemory: {
    name: 'pruneMemory',
    description:
      'Permanently deletes a specific memory item from the neural reserve. Use this to remove stale, incorrect, or redundant information.',
    parameters: {
      type: 'object',
      properties: {
        partitionKey: {
          type: 'string',
          description:
            'The full partition key (ID) of the memory item (e.g., "USER#123", "LESSON#456").',
        },
        timestamp: {
          type: 'number',
          description: 'The exact timestamp (sort key) of the memory item.',
        },
      },
      required: ['partitionKey', 'timestamp'],
      additionalProperties: false,
    },
  },
  discoverSkills: {
    name: 'discoverSkills',
    description: 'Searches the project for matching skill definitions.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query or keyword (optional).' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  installSkill: {
    name: 'installSkill',
    description: 'Installs a specific discovered skill for an agent.',
    parameters: {
      type: 'object',
      properties: {
        skillName: { type: 'string', description: 'Name of the skill to install.' },
        agentId: { type: 'string', description: 'ID of the agent (e.g., coder).' },
      },
      required: ['skillName', 'agentId'],
      additionalProperties: false,
    },
  },
  uninstallSkill: {
    name: 'uninstallSkill',
    description: 'Removes a previously installed skill from an agent.',
    parameters: {
      type: 'object',
      properties: {
        skillName: { type: 'string', description: 'Name of the skill to remove.' },
        agentId: { type: 'string', description: 'ID of the agent.' },
      },
      required: ['skillName', 'agentId'],
      additionalProperties: false,
    },
  },
  prioritizeMemory: {
    name: 'prioritizeMemory',
    description:
      'Adjusts the priority, urgency, and impact scores of a memory insight or capability gap.',
    parameters: {
      type: 'object',
      properties: {
        timestamp: {
          type: 'number',
          description: 'The timestamp (sort key) of the memory item.',
        },
        priority: {
          type: 'number',
          description: 'New priority score (0-10).',
        },
        urgency: {
          type: 'number',
          description: 'New urgency score (0-10).',
        },
        impact: {
          type: 'number',
          description: 'New impact score (0-10).',
        },
      },
      required: ['timestamp'],
      additionalProperties: false,
    },
    argSchema: z.object({
      userId: z.string(),
      timestamp: z.number(),
      priority: z.number().min(0).max(10).optional(),
      urgency: z.number().min(0).max(10).optional(),
      impact: z.number().min(0).max(10).optional(),
    }),
    connectionProfile: ['memory'],
  },
  deleteTraces: {
    name: 'deleteTraces',
    description:
      'Deletes execution traces. Pass "all" to purge all traces, or a specific trace ID to delete one.',
    parameters: {
      type: 'object',
      properties: {
        traceId: {
          type: 'string',
          description: 'The trace ID to delete, or "all" to purge all traces.',
        },
      },
      required: ['traceId'],
      additionalProperties: false,
    },
    connectionProfile: ['trace'],
  },
  refineMemory: {
    name: 'refineMemory',
    description:
      'Updates or corrects an existing memory item. Use this when you have new information that refines a previous conclusion or lesson.',
    parameters: {
      type: 'object',
      properties: {
        timestamp: {
          type: 'number',
          description: 'The exact timestamp (sort key) of the memory item to refine.',
        },
        content: {
          type: 'string',
          description: 'The new or updated content for the memory.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated tags for the memory.',
        },
        priority: {
          type: 'number',
          description: 'New priority score (0-10).',
        },
      },
      required: ['timestamp'],
      additionalProperties: false,
    },
    argSchema: z.object({
      userId: z.string(),
      timestamp: z.number(),
      content: z.string().optional(),
      tags: z.array(z.string()).optional(),
      priority: z.number().min(0).max(10).optional(),
    }),
    connectionProfile: ['memory'],
  },
  forceReleaseLock: {
    name: 'forceReleaseLock',
    description: 'Force-releases a distributed session lock by deleting it from memory.',
    parameters: {
      type: 'object',
      properties: {
        lockId: { type: 'string', description: 'ID of the lock to release.' },
      },
      required: ['lockId'],
      additionalProperties: false,
    },
  },
  technicalResearch: {
    name: 'technicalResearch',
    description:
      'Dispatches a technical research task. Supports single-step discovery or parallel multi-agent exploration.',
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description:
            'The technical research goal or question (e.g., "Research Auth0 vs Cognito").',
        },
        agentId: {
          type: 'string',
          description: 'The research agent to use. Defaults to "researcher".',
        },
        parallel: {
          type: 'boolean',
          description:
            'Whether to allow the agent to decompose this into parallel sub-tasks. Recommended for complex comparisons.',
        },
        depth: {
          type: 'number',
          description: 'Current recursion depth.',
        },
      },
      required: ['goal'],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
  },
  requestResearch: {
    name: 'requestResearch',
    description:
      'Dispatches a technical research mission to the Researcher Agent. The current agent execution will pause until research is completed.',
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description:
            'The technical research goal or question (e.g., "Research Auth0 vs Cognito").',
        },
        parallel: {
          type: 'boolean',
          description: 'Whether to allow the agent to decompose this into parallel sub-tasks.',
        },
      },
      required: ['goal'],
      additionalProperties: false,
    },
    connectionProfile: ['bus'],
  },

  // MCP (from mcp.ts)
  registerMCPServer: {
    name: 'registerMCPServer',
    description: 'Registers a new Model Context Protocol (MCP) server for dynamic tool discovery.',
    parameters: {
      type: 'object',
      properties: {
        serverName: {
          type: 'string',
          description: 'A unique name for the server (e.g., git, search).',
        },
        command: {
          type: 'string',
          description: 'The command to run the server (e.g., npx @mcp/server-git).',
        },
        env: {
          type: 'string',
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
      type: 'object',
      properties: {
        serverName: {
          type: 'string',
          description: 'The name of the MCP server to remove.',
        },
      },
      required: ['serverName'],
      additionalProperties: false,
    },
  },
  getMcpConfig: {
    name: 'getMcpConfig',
    description: 'Retrieves the current Model Context Protocol (MCP) servers configuration.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },

  // Runtime Config (from config.ts)
  checkConfig: {
    name: 'checkConfig',
    description:
      'Retrieves the current runtime configuration, including active LLM provider and model.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
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
        value: {
          type: 'string',
          description: 'The new value for the configuration (JSON stringified if object).',
        },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
  },
  listSystemConfigs: {
    name: 'listSystemConfigs',
    description: 'Lists all available runtime configuration keys and their current values.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },

  // Metadata (from metadata.ts)
  getSystemConfigMetadata: {
    name: 'getSystemConfigMetadata',
    description:
      'Retrieves technical documentation, implications, and risks for all system configuration keys.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  inspectTrace: {
    name: 'inspectTrace',
    description: 'Retrieves the full execution trace for a given trace ID.',
    parameters: {
      type: 'object',
      properties: {
        traceId: { type: 'string', description: 'The trace ID to inspect.' },
      },
      required: ['traceId'],
      additionalProperties: false,
    },
  },
};
