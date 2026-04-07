/**
 * Maintenance Handler for Serverless Claw.
 * Periodically processes background tasks such as stale collaborations,
 * proactive evolution, and trace cleanup.
 */
import { Context } from 'aws-lambda';
import { logger } from '../lib/logger';
import { DynamoMemory } from '../lib/memory/dynamo-memory';
import { EvolutionScheduler } from '../lib/safety/evolution-scheduler';
import { CONFIG_DEFAULTS } from '../lib/config/config-defaults';
import { emitTypedEvent } from '../lib/utils/typed-emit';
import { EventType } from '../lib/types/agent';

/**
 * Main maintenance loop. Designed to be triggered by a CloudWatch Event (cron).
 */
export const handler = async (_event: any, _context: Context): Promise<void> => {
  logger.info('[MAINTENANCE] starting cycle...');

  const memory = new DynamoMemory();
  const evolutionScheduler = new EvolutionScheduler(memory);

  try {
    // 1. Process Proactive Evolutions (Class C timeouts)
    const evolutionCount = await evolutionScheduler.triggerTimedOutActions();
    if (evolutionCount > 0) {
      logger.info(`[MAINTENANCE] Triggered ${evolutionCount} proactive evolution actions`);
    }

    // 2. Process Stale Collaborations (Conflict resolution timeouts)
    const staleCollabs = await memory.findStaleCollaborations(
      CONFIG_DEFAULTS.TIE_BREAK_TIMEOUT_MS.code
    );

    for (const collab of staleCollabs) {
      logger.info(
        `[MAINTENANCE] Collaboration ${collab.collaborationId} timed out. Initializing strategic tie-break.`
      );

      await emitTypedEvent('maintenance.handler', EventType.STRATEGIC_TIE_BREAK, {
        userId: collab.syntheticUserId,
        agentId: 'facilitator',
        task: `Strategic tie-break required for timed out collaboration: ${collab.name}. Rationale: The human participants or assigned admin failed to resolve conflicting instructions within the allotted ${CONFIG_DEFAULTS.TIE_BREAK_TIMEOUT_MS.code / 60000} minute window.`,
        sessionId: collab.sessionId,
        metadata: {
          collaborationId: collab.collaborationId,
          timeout: true,
          lastActivityAt: collab.lastActivityAt,
        },
      });
    }

    // 3. Stale Gap Archival (Existing functionality)
    const archivedGaps = await memory.archiveStaleGaps(CONFIG_DEFAULTS.STALE_GAP_DAYS.code);
    if (archivedGaps > 0) {
      logger.info(`[MAINTENANCE] Archived ${archivedGaps} stale capability gaps`);
    }

    logger.info('[MAINTENANCE] cycle completed successfully.');
  } catch (error) {
    logger.error('[MAINTENANCE] cycle failed:', error);
    throw error;
  }
};
