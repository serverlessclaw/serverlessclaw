import { Context } from 'aws-lambda';
import { logger } from '../lib/logger';
import { emitEvent, EventPriority } from '../lib/utils/bus';
import { EventType, ProactiveHeartbeatPayload } from '../lib/types/agent';

export async function handler(event: ProactiveHeartbeatPayload, _context: Context): Promise<void> {
  logger.info('HeartbeatHandler triggered by schedule:', JSON.stringify(event, null, 2));

  try {
    if (!event.agentId || !event.task || !event.goalId) {
      logger.error('Invalid heartbeat payload received from Scheduler: missing mandatory fields.');
      throw new Error('Invalid heartbeat payload: missing mandatory fields');
    }

    await emitEvent(
      'heartbeat.scheduler',
      EventType.HEARTBEAT_PROACTIVE,
      event as unknown as Record<string, unknown>,
      { priority: EventPriority.HIGH }
    );

    logger.info(
      `Proactive heartbeat emitted for goal: ${event.goalId} (${event.agentId}/${event.task})`
    );
  } catch (error) {
    logger.error('Failed to process proactive heartbeat:', error);
    const { reportHealthIssue } = await import('./events/shared');
    await reportHealthIssue({
      component: 'HeartbeatHandler',
      issue: `Heartbeat processing failed: ${error instanceof Error ? error.message : String(error)}`,
      severity: 'high',
      userId: 'SYSTEM',
      traceId: 'heartbeat',
    });
    throw error;
  }
}
