import { IToolDefinition } from '../../lib/types/index';

/**
 * Clarification tool definitions for human-in-the-loop interactions.
 */
export const clarificationTools: Record<string, IToolDefinition> = {
  seekClarification: {
    name: 'seekClarification',
    description: 'Pauses the current agent and requests clarification from the initiator.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The specific question for the initiator.' },
        originalTask: {
          type: 'string',
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
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The ID of the agent that requested clarification.',
        },
        answer: { type: 'string', description: 'The answer to the question.' },
        originalTask: {
          type: 'string',
          description: 'The task the agent was working on.',
        },
      },
      required: ['agentId', 'answer', 'originalTask'],
      additionalProperties: false,
    },
  },
};
