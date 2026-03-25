import { IToolDefinition } from '../../lib/types/index';
import { AgentStatus, AgentType } from '../../lib/types/agent';

/**
 * Orchestration tool definitions for high-level agent coordination.
 */
export const orchestrationTools: Record<string, IToolDefinition> = {
  signalOrchestration: {
    name: 'signalOrchestration',
    description:
      'Emits a high-level orchestration signal to decide the next step in a task lifecycle. Use this to RETRY a failed task, PIVOT to a new agent/strategy, ESCALATE to a human, or finalize with SUCCESS/FAILED.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: [
            AgentStatus.SUCCESS,
            AgentStatus.FAILED,
            AgentStatus.RETRY,
            AgentStatus.PIVOT,
            AgentStatus.ESCALATE,
          ],
          description: 'The operational decision.',
        },
        reasoning: {
          type: 'string',
          description: 'The logic behind this decision.',
        },
        nextStep: {
          type: 'string',
          description: 'Actionable instructions for the next agent or question for the human.',
        },
        targetAgentId: {
          type: 'string',
          enum: Object.values(AgentType),
          description: 'The agent to delegate to (required for PIVOT).',
        },
      },
      required: ['status', 'reasoning', 'nextStep', 'targetAgentId'],
      additionalProperties: false,
    },
  },
};
