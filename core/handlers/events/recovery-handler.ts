/**
 * Recovery Event Handler
 * Processes emergency rollback logs and recovery signals
 */

import { logger } from '../../lib/logger';
import { DynamoMemory } from '../../lib/memory';

const memory = new DynamoMemory();

/**
 * Handles recovery log events
 *
 * @param eventDetail - The event detail containing recovery log information
 */
export async function handleRecoveryLog(eventDetail: Record<string, unknown>): Promise<void> {
  const { _userId, task, traceId, sessionId } = eventDetail as {
    _userId: string;
    task: string;
    traceId: string;
    sessionId: string;
  };

  logger.info(`[RECOVERY_LOG] Received for traceId=${traceId} | sessionId=${sessionId}`);

  // Store distilled recovery log for agent context retrieval (Principle 1)
  if (traceId && task) {
    try {
      await memory.saveDistilledRecoveryLog(traceId as string, task as string);
      logger.info(`[RECOVERY_LOG] Distilled log saved for traceId=${traceId}`);
    } catch (error) {
      logger.error(`[RECOVERY_LOG] Failed to save distilled log for ${traceId}:`, error);
    }
  }
}
