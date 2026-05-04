import { logger } from '../../logger';
import { BaseMemoryProvider } from '../../memory/base';
import { AuditFinding } from '../../../agents/cognition-reflector/lib/audit-definitions';
import { AgentRegistry } from '../../registry/AgentRegistry';
import { cullResolvedGaps, setGap } from '../../memory/gap-operations';
import { InsightCategory } from '../../types/memory';
import { EvolutionScheduler } from '../../safety/evolution-scheduler';
import { FailureEventPayload } from '../../schema/events';
import { ConfigManager } from '../../registry/config';
import { DYNAMO_KEYS } from '../../constants';
import { getStagingBucketName } from '../../utils/resource-helpers';
import { pruneStagingBucket } from './repairs';

/**
 * Performs immediate remediation for a detected dashboard failure.
 * Sh7: Live remediation bridge for real-time system stability.
 */
export async function remediateDashboardFailure(
  memory: BaseMemoryProvider,
  failure: FailureEventPayload
): Promise<AuditFinding | undefined> {
  const workspaceId = (failure as Record<string, unknown>).workspaceId as string | undefined;

  logger.info(
    `[Metabolism] Attempting immediate remediation for trace ${failure.traceId} in workspace ${workspaceId}`
  );

  const error = failure.error.toLowerCase();

  // Strategy 1: Registry mismatch/stale overrides (Common dashboard issue)
  if (error.includes('tool') || error.includes('registry') || error.includes('override')) {
    let pruned = false;
    const toolMatch =
      failure.error.match(/tool\s+['"]([^'"]+)['"]/i) ||
      failure.error.match(/['"]([^'"]+)['"]\s+tool/i);

    try {
      if (toolMatch && toolMatch[1]) {
        const toolName = toolMatch[1];
        const agentId = failure.agentId || 'unknown';

        logger.info(`[Metabolism] Surgical remediation for tool: ${toolName}`);
        await ConfigManager.atomicRemoveFromMap(
          DYNAMO_KEYS.AGENT_TOOL_OVERRIDES,
          agentId,
          [toolName],
          { workspaceId }
        );
        // Also prune tool metadata to prevent stale configuration debt
        await ConfigManager.atomicRemoveFieldsFromMap(
          DYNAMO_KEYS.TOOL_METADATA_OVERRIDES,
          [toolName],
          { workspaceId }
        );
        pruned = true;
      }

      if (!pruned && workspaceId) {
        // Fallback to broad pruning using atomic utilization check
        const prunedCount = await AgentRegistry.pruneLowUtilizationTools(workspaceId, 1);
        pruned = prunedCount > 0;
      }
    } catch (e) {
      logger.error(`[Metabolism] Tool override remediation failed:`, e);
      // Let it fall through to the HITL scheduling below
    }

    if (pruned) {
      return {
        silo: 'Metabolism',
        expected: 'Consistent agent registry',
        actual: `Real-time repair: Pruned stale/failing tool overrides atomically.`,
        severity: 'P2',
        recommendation: 'Autonomous repair executed successfully via Silo 7 bridge.',
      };
    }
  }

  // Strategy 1b: S3 Artifact/Staging inconsistencies
  if (error.includes('s3') || error.includes('access denied') || error.includes('not found')) {
    const bucketName = getStagingBucketName();
    if (bucketName && bucketName !== 'StagingBucket') {
      try {
        const reclaimed = await pruneStagingBucket({ workspaceId });
        if (reclaimed > 0) {
          return {
            silo: 'Metabolism',
            expected: 'Accessible staging artifacts',
            actual: `Real-time repair: Metabolized staging bucket to clear access/stale inconsistencies.`,
            severity: 'P2',
            recommendation: 'S3 state reset performed. Retrying operation may now succeed.',
          };
        }
      } catch (e) {
        logger.error(`[Metabolism] S3 staging bucket remediation failed:`, e);
      }
    }
  }

  // Strategy 2: Memory/Gap inconsistencies
  if (error.includes('memory') || error.includes('gap')) {
    try {
      await cullResolvedGaps(memory, undefined, workspaceId);
      return {
        silo: 'Metabolism',
        expected: 'Clean memory state',
        actual: `Real-time repair: Culled resolved gaps to resolve memory inconsistency.`,
        severity: 'P2',
        recommendation: 'Autonomous repair executed successfully.',
      };
    } catch (e) {
      logger.error(`[Metabolism] Memory gap remediation failed:`, e);
    }
  }

  // Fallback: Schedule HITL evolution for complex/unknown errors
  logger.warn(`[Metabolism] Complex error detected, scheduling HITL remediation: ${failure.error}`);
  const scheduler = new EvolutionScheduler(memory);
  await scheduler.scheduleAction({
    agentId: failure.agentId || 'unknown',
    action: 'REMEDIATION',
    reason: `Unresolved dashboard error: ${failure.error}`,
    timeoutMs: 3600000, // 1 hour
    traceId: failure.traceId,
    userId: failure.userId,
    workspaceId: workspaceId || 'SYSTEM',
  });

  // Also propagate as a strategic gap for visibility
  await setGap(
    memory,
    `REMEDIATION-${failure.traceId}`,
    `Immediate remediation required: ${failure.error}`,
    { category: InsightCategory.STRATEGIC_GAP, urgency: 5, impact: 8 },
    workspaceId
  );

  return undefined;
}
