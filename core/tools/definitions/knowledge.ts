import { IToolDefinition } from '../../lib/types/index';

const TYPE_OBJECT = 'object';
const TYPE_STRING = 'string';
const TYPE_NUMBER = 'number';

/**
 * Knowledge and memory tool definitions.
 */
export const knowledgeTools: Record<string, IToolDefinition> = {
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
  saveMemory: {
    name: 'saveMemory',
    description: 'Directly saves a new fact or user preference into the system memory.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        content: { type: TYPE_STRING, description: 'The fact or preference to save.' },
        category: {
          type: TYPE_STRING,
          enum: ['user_preference', 'system_knowledge'],
          description: 'The category of the knowledge.',
        },
      },
      required: ['content', 'category'],
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
  pruneMemory: {
    name: 'pruneMemory',
    description: 'Permanently deletes a specific memory item from the neural reserve. Use this to remove stale, incorrect, or redundant information.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        partitionKey: {
          type: TYPE_STRING,
          description: 'The full partition key (ID) of the memory item (e.g., "USER#123", "LESSON#456").',
        },
        timestamp: {
          type: TYPE_NUMBER,
          description: 'The exact timestamp (sort key) of the memory item.',
        },
      },
      required: ['partitionKey', 'timestamp'],
      additionalProperties: false,
    },
  },
};
