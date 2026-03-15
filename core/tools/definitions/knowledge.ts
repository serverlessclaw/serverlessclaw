import { IToolDefinition } from '../../lib/types/index';

/**
 * Knowledge and memory tool definitions.
 */
export const knowledgeTools: Record<string, IToolDefinition> = {
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
    connectionProfile: ['memory'],
  },
  saveMemory: {
    name: 'saveMemory',
    description: 'Directly saves a new fact or user preference into the system memory.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact or preference to save.' },
        category: {
          type: 'string',
          enum: ['user_preference', 'system_knowledge'],
          description: 'The category of the knowledge.',
        },
      },
      required: ['content', 'category'],
      additionalProperties: false,
    },
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
          enum: ['strategic_gap', 'tactical_lesson', 'system_knowledge'],
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
};
