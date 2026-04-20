import { PULSE_EVENT_SCHEMA } from '../../lib/schema/events';
import { emitEvent } from '../../lib/utils/bus';
import { EventType } from '../../lib/types/index';
import { Context } from 'aws-lambda';
import { logger } from '../../lib/logger';

/**
 * Handles pulse ping events by responding with a pong.
 * Verifies that the internal event bus is functional and agents are responsive.
 */
export async function handlePulsePing(
  eventDetail: Record<string, unknown>,
  _context: Context
): Promise<void> {
  const { targetAgentId, userId, traceId, nodeId, initiatorId, sessionId, workspaceId, timestamp } =
    PULSE_EVENT_SCHEMA.parse(eventDetail);

  const currentAgentId = process.env.AGENT_ID || 'unknown';
  if (targetAgentId !== currentAgentId) {
    logger.debug(`[PULSE] Skipping ping for ${targetAgentId} (Current: ${currentAgentId})`);
    return;
  }

  logger.info(`[PULSE] Received ping for ${targetAgentId} from ${initiatorId}. Responding...`);

  try {
    await emitEvent(targetAgentId, EventType.PULSE_PONG, {
      userId,
      targetAgentId,
      timestamp,
      responseTimestamp: Date.now(),
      status: 'pong',
      traceId,
      nodeId,
      parentId: nodeId,
      initiatorId: targetAgentId,
      sessionId,
      workspaceId,
    });
    logger.info(`[PULSE] Pong emitted for ${targetAgentId}.`);
  } catch (error) {
    logger.error(`[PULSE] Failed to emit pong for ${targetAgentId}:`, error);
  }
}
