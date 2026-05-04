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
import { TrustManager } from '../lib/safety/trust-manager';

/**
 * Main maintenance loop. Designed to be triggered by a CloudWatch Event (cron).
 */
export const handler = async (_event: unknown, _context: Context): Promise<void> => {
  logger.info('[MAINTENANCE] starting cycle...');

  const memory = new DynamoMemory();
  const evolutionScheduler = new EvolutionScheduler(memory);

  try {
    // 1. Process Proactive Evolutions & Trust Score Decay (Multi-tenant scoped)
    await TrustManager.decayTrustScores(); // Global scores first

    const { PromotionManager } = await import('../lib/lifecycle/promotion-manager');

    const { MetabolismService } = await import('../lib/maintenance/metabolism');
    const { AgentRegistry } = await import('../lib/registry/AgentRegistry');

    try {
      const { listWorkspaceIds } = await import('../lib/memory/workspace-operations');
      const workspaceIds = await listWorkspaceIds();

      // Maintenance loop over all workspaces
      for (const workspaceId of workspaceIds) {
        // Proactive evolution for each workspace
        const evolutionCount = await evolutionScheduler.triggerTimedOutActions(workspaceId);
        if (evolutionCount > 0) {
          logger.info(`[MAINTENANCE] Triggered ${evolutionCount} actions in WS: ${workspaceId}`);
        }

        // Trust decay for each workspace (Silo 6)
        await TrustManager.decayTrustScores(workspaceId);

        // Run full Metabolism Audit (including Repair 2: Gap Archival/Culling)
        // This fixes the multi-tenant memory leak (Audit Finding 2)
        await MetabolismService.runMetabolismAudit(memory, {
          repair: true,
          workspaceId,
        });
      }

      // Also check global agents and perform global repairs
      await TrustManager.decayTrustScores();
      await MetabolismService.runMetabolismAudit(memory, { repair: true });

    } catch (error) {
      logger.warn('[MAINTENANCE] Multi-tenant maintenance cycle failed:', error);
    }

    // 2. Process Stale Collaborations (Conflict resolution timeouts)
    const staleCollabs = await memory.findStaleCollaborations(
      CONFIG_DEFAULTS.TIE_BREAK_TIMEOUT_MS.code
    );

    const { TRUST } = await import('../lib/constants/system');

    for (const collab of staleCollabs) {
      const facilitatorConfig = await AgentRegistry.getAgentConfig('facilitator');
      const trustScore = facilitatorConfig?.trustScore ?? TRUST.DEFAULT_SCORE;

      if (trustScore < TRUST.FACILITATOR_THRESHOLD) {
        logger.warn(
          `[MAINTENANCE] Skipping tie-break for ${collab.collaborationId}: Facilitator trust (${trustScore}) below threshold (${TRUST.FACILITATOR_THRESHOLD}).`
        );
        continue;
      }

      await emitTypedEvent('maintenance.handler', EventType.STRATEGIC_TIE_BREAK, {
        userId: collab.syntheticUserId,
        agentId: 'facilitator',
        task: `Strategic tie-break required for timed out collaboration: ${collab.name}.`,
        sessionId: collab.sessionId,
        metadata: {
          collaborationId: collab.collaborationId,
          timeout: true,
          lastActivityAt: collab.lastActivityAt,
        },
      });
    }

    logger.info('[MAINTENANCE] cycle completed successfully.');
  } catch (error) {
    logger.error('[MAINTENANCE] cycle failed:', error);
    throw error;
  }
};
