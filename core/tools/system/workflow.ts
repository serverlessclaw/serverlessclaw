import { systemSchema as schema } from './schema';
import { formatErrorMessage } from '../../lib/utils/error';
import { SessionStateManager } from '../../lib/session/session-state';
import { DynamoMemory } from '../../lib/memory/dynamo-memory';
import { CachedMemory } from '../../lib/memory/cached-memory';

/**
 * Suspends the current agent workflow and saves its state to DynamoDB.
 */
export const pauseWorkflow = {
  ...schema.pauseWorkflow,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { reason, metadata, sessionId, executorAgentId, originalUserTask, userId } = args as {
      reason: string;
      metadata?: Record<string, unknown>;
      sessionId: string;
      executorAgentId: string;
      originalUserTask: string;
      userId: string;
    };

    try {
      if (!sessionId) return 'FAILED: No active session found in context.';

      // Initialize memory to fetch history for state serialization
      const memory = new CachedMemory(new DynamoMemory());

      // Determine the storageId (same logic as in Agent.ts)
      // Usually it's just the userId unless it's an isolated trace
      const storageId = userId;
      const history = await memory.getHistory(storageId, sessionId);

      const sessionStateManager = new SessionStateManager();
      await sessionStateManager.saveSnapshot(sessionId, {
        reason,
        timestamp: Date.now(),
        agentId: executorAgentId,
        task: originalUserTask,
        state: {
          historyCount: history.length,
          // We could store more granular state here if needed,
          // like the current plan step from the Planner.
        },
        metadata: {
          ...metadata,
          userId,
          storageId,
        },
      });

      return `TASK_PAUSED: Workflow suspended. Reason: ${reason}. Session ID: ${sessionId}`;
    } catch (error) {
      return `FAILED_TO_PAUSE: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Resumes a previously paused workflow.
 */
export const resumeWorkflow = {
  ...schema.resumeWorkflow,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { sessionId: providedSessionId } = args as { sessionId?: string };
    try {
      const { sessionId: contextSessionId } = args as { sessionId?: string };
      const sessionId = providedSessionId || contextSessionId;

      if (!sessionId) return 'FAILED: No session ID provided or found in context.';

      const sessionStateManager = new SessionStateManager();
      const state = await sessionStateManager.getState(sessionId);

      if (!state?.workflowSnapshot) {
        return `FAILED: No active snapshot found for session ${sessionId}.`;
      }

      const { workflowSnapshot } = state;

      // Clear the snapshot before resuming to prevent loops
      await sessionStateManager.clearSnapshot(sessionId);

      // Trigger resumption via the agent bus
      const { emitEvent } = await import('../../lib/utils/bus');
      const { EventType } = await import('../../lib/types/agent');

      // Map agentId to EventType if possible, or use CONTINUATION_TASK
      // Typically, we want to re-trigger the original agent with the same task.
      await emitEvent(EventType.CONTINUATION_TASK, `resume_${workflowSnapshot.agentId}`, {
        userId: workflowSnapshot.metadata?.userId || 'system',
        agentId: workflowSnapshot.agentId,
        task: workflowSnapshot.task,
        sessionId,
        traceId: `resume-${Date.now()}`,
        isContinuation: true,
        metadata: workflowSnapshot.metadata,
      });

      return `SUCCESS: Workflow resumption triggered for session ${sessionId} (${workflowSnapshot.agentId}).`;
    } catch (error) {
      return `FAILED_TO_RESUME: ${formatErrorMessage(error)}`;
    }
  },
};
