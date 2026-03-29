import { collaborationSchema as schema } from './schema';
import { emitEvent } from '../../lib/utils/bus';
import { EventType } from '../../lib/types/agent';
import { ClarificationStatus } from '../../lib/types/memory';
import { formatErrorMessage } from '../../lib/utils/error';

/**
 * Pauses the current agent and requests clarification from the initiator.
 */
export const seekClarification = {
  ...schema.seekClarification,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const {
      userId,
      agentId,
      question,
      traceId,
      initiatorId,
      depth,
      sessionId,
      originalTask,
      task,
    } = args as {
      userId: string;
      agentId?: string;
      question: string;
      traceId?: string;
      initiatorId?: string;
      depth?: number;
      sessionId?: string;
      originalTask?: string;
      task?: string;
    };

    try {
      await emitEvent(initiatorId ?? 'superclaw', EventType.CLARIFICATION_REQUEST, {
        userId,
        agentId,
        question,
        traceId,
        initiatorId: initiatorId ?? 'superclaw',
        depth: (depth ?? 0) + 1,
        sessionId,
        originalTask: originalTask ?? task ?? 'Unknown task',
      });
      return `TASK_PAUSED: I've sent a clarification request to **${initiatorId ?? 'superclaw'}**. I'll wait for their response before continuing with your task.`;
    } catch (error) {
      return `Failed to seek clarification: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Provides an answer to a clarification request, resuming the target agent.
 */
export const provideClarification = {
  ...schema.provideClarification,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { userId, agentId, answer, traceId, sessionId, depth, initiatorId, originalTask } =
      args as {
        userId: string;
        agentId: string;
        answer: string;
        traceId?: string;
        sessionId?: string;
        depth?: number;
        initiatorId?: string;
        originalTask: string;
      };

    try {
      await emitEvent('agent.tool', EventType.CONTINUATION_TASK, {
        userId,
        agentId,
        task: `CLARIFICATION_RESPONSE: For your task "${originalTask}", here is the answer: 
        ---
        ${answer}
        ---
        Please proceed with this information.`,
        traceId,
        sessionId,
        depth: (depth ?? 0) + 1,
        initiatorId,
        isContinuation: true,
      });

      if (traceId && agentId) {
        try {
          const { DynamoMemory } = await import('../../lib/memory');
          const memory = new DynamoMemory();
          await memory.updateClarificationStatus(traceId, agentId, ClarificationStatus.ANSWERED);
        } catch (memError) {
          console.warn('Failed to update clarification status:', memError);
        }
      }

      return `Clarification provided to ${agentId}. Continuation task emitted.`;
    } catch (error) {
      return `Failed to provide clarification: ${formatErrorMessage(error)}`;
    }
  },
};
