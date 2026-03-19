import { Context } from 'aws-lambda';
import { logger } from '../lib/logger';
import { emitEvent } from '../lib/utils/bus';
import { EventType, ProactiveHeartbeatPayload } from '../lib/types/agent';

/**
 * Proactive Heartbeat Handler.
 * Acts as the dynamic target for AWS EventBridge Scheduler.
 * Receives the schedule payload and converts it into a system-wide proactive heartbeat signal.
 *
 * @param event - The payload from the AWS Scheduler.
 * @param _context - The AWS Lambda context (unused).
 */
export async function handler(event: ProactiveHeartbeatPayload, _context: Context): Promise<void> {
  logger.info('HeartbeatHandler triggered by schedule:', JSON.stringify(event, null, 2));

  try {
    // 1. Validate mandatory fields (though Scheduler ensures Input is valid JSON, we verify our contract)
    if (!event.agentId || !event.task || !event.goalId) {
      logger.error('Invalid heartbeat payload received from Scheduler: missing mandatory fields.');
      return;
    }

    // 2. Emit Proactive Signal to AgentBus
    // This wakes up the relevant agent (or the main orchestrator) to perform the goal.
    await emitEvent(
      'heartbeat.scheduler',
      EventType.HEARTBEAT_PROACTIVE,
      event as unknown as Record<string, unknown>
    );

    logger.info(
      `Proactive heartbeat emitted for goal: ${event.goalId} (${event.agentId}/${event.task})`
    );
  } catch (error) {
    logger.error('Failed to process proactive heartbeat:', error);
  }
}
