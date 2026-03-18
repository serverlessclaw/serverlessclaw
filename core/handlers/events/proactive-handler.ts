import { Context } from 'aws-lambda';
import { logger } from '../../lib/logger';
import { emitTaskEvent } from '../../lib/utils/agent-helpers';
import { AgentType } from '../../lib/types/index';
import { ProactiveHeartbeatPayload } from '../../lib/types/agent';

/**
 * Handles proactive heartbeat signals from the dynamic scheduler.
 * Routes the proactive goal to the responsible agent for execution.
 *
 * @param event - The proactive heartbeat payload.
 * @param context - The AWS Lambda context.
 */
export const handleProactiveHeartbeat = async (
  event: Record<string, unknown>,
  _context: Context
): Promise<void> => {
  const payload = event as unknown as ProactiveHeartbeatPayload;
  logger.info(
    `Processing proactive heartbeat for goal: ${payload.goalId} (${payload.agentId}/${payload.task})`
  );

  try {
    // Dispatch the task to the responsible agent
    await emitTaskEvent({
      source: 'heartbeat.scheduler',
      userId: payload.userId ?? 'SYSTEM',
      agentId: payload.agentId as AgentType,
      task: payload.task,
      traceId: payload.traceId,
      initiatorId: 'SYSTEM#SCHEDULER',
      metadata: {
        ...payload.metadata,
        goalId: payload.goalId,
        isProactive: true,
      },
    });

    logger.info(`Successfully dispatched proactive task for goal: ${payload.goalId}`);
  } catch (error) {
    logger.error(`Failed to dispatch proactive task for goal ${payload.goalId}:`, error);
  }
};
