import { IToolDefinition } from '../../lib/types/index';

const TYPE_OBJECT = 'object';
const TYPE_STRING = 'string';

/**
 * Clarification tool definitions for human-in-the-loop interactions.
 */
export const clarificationTools: Record<string, IToolDefinition> = {
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
};
