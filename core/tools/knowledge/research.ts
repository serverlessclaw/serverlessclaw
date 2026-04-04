import { knowledgeSchema } from './schema';
import { emitEvent } from '../../lib/utils/bus';
import { formatErrorMessage } from '../../lib/utils/error';

/**
 * Dispatches a technical research mission to the Researcher Agent.
 * The current agent execution will pause until the researcher completes the task.
 */
export const requestResearch = {
  ...knowledgeSchema.requestResearch,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { goal, parallel, userId, traceId, nodeId, initiatorId, depth, sessionId } = args as {
      goal: string;
      parallel?: boolean;
      userId: string;
      traceId?: string;
      nodeId?: string;
      initiatorId?: string;
      depth?: number;
      sessionId?: string;
    };

    const targetAgentId = 'researcher';

    // Lazy load tracer to avoid startup overhead
    const { ClawTracer } = await import('../../lib/tracer');
    const tracer = new ClawTracer(userId, 'system', traceId, nodeId);
    const childTracer = tracer.getChildTracer(undefined, targetAgentId);

    try {
      // Emit the internal research_task event
      await emitEvent(initiatorId ?? 'superclaw', 'research_task', {
        userId,
        task: goal,
        metadata: {
          parallelAllowed: parallel !== false,
        },
        traceId: childTracer.getTraceId(),
        nodeId: childTracer.getNodeId(),
        parentId: childTracer.getParentId(),
        initiatorId: initiatorId ?? 'superclaw',
        depth: (depth ?? 0) + 1,
        sessionId,
      });

      // Returning TASK_PAUSED signals to the AgentRunner that this agent is now waiting for an external signal
      return `TASK_PAUSED: I have successfully delegated the research mission to the **Researcher Agent**. 
Goal: "${goal}"
I'll resume my logic once the results are available.`;
    } catch (error) {
      return `Failed to initiate research delegation: ${formatErrorMessage(error)}`;
    }
  },
};
