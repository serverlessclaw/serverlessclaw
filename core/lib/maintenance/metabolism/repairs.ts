import { logger } from '../../logger';
import { BaseMemoryProvider } from '../../memory/base';
import { IAgentConfig } from '../../types/index';
import { EvolutionMode } from '../../types/agent/status';
import { AgentRegistry } from '../../registry/AgentRegistry';
import { archiveStaleGaps, cullResolvedGaps } from '../../memory/gap-operations';
import { ConfigManager } from '../../registry/config';
import { FeatureFlags } from '../../feature-flags';
import { AuditFinding } from '../../../agents/cognition-reflector/lib/audit-definitions';
import { getStagingBucketName } from '../../utils/resource-helpers';

/**
 * Executes autonomous repairs on system state.
 */
export async function executeRepairs(
  memory: BaseMemoryProvider,
  scope: { workspaceId?: string; teamId?: string; staffId?: string }
): Promise<AuditFinding[]> {
  const repairFindings: AuditFinding[] = [];
  const workspaceId = scope.workspaceId;

  // Repair 1: Agent Registry Low-Utilization Tools (Principle 10)
  try {
    const pruned = await AgentRegistry.pruneLowUtilizationTools(workspaceId, 30);
    if (pruned > 0) {
      repairFindings.push({
        silo: 'Metabolism',
        expected: 'Lean agent tool registry',
        actual: `Pruned ${pruned} low-utilization tools from agent overrides (Scope: ${workspaceId || 'GLOBAL'}).`,
        severity: 'P2',
        recommendation: 'Principle 10 (Lean Evolution) enforced via registry pruning.',
      });
    }
  } catch (e) {
    logger.error(`[Metabolism] Registry tool pruning failed (WS: ${workspaceId || 'GLOBAL'}):`, e);
  }

  // Repair 2: Memory Bloat (Stale Gaps)
  try {
    const archived = await archiveStaleGaps(memory, undefined, workspaceId);
    const culled = await cullResolvedGaps(memory, undefined, workspaceId);
    if (archived > 0 || culled > 0) {
      repairFindings.push({
        silo: 'Metabolism',
        expected: 'Clean knowledge state',
        actual: `Metabolized memory state: archived ${archived} stale gaps, culled ${culled} resolved gaps.`,
        severity: 'P2',
        recommendation: 'Knowledge debt recycled into archival storage.',
      });
    }
  } catch (e) {
    logger.error(`[Metabolism] Memory repair failed (WS: ${workspaceId || 'GLOBAL'}):`, e);
  }

  // Repair 3: Stale Feature Flags (Silo 7)
  try {
    const prunedFlags = await FeatureFlags.pruneStaleFlags(30, workspaceId);
    if (prunedFlags > 0) {
      repairFindings.push({
        silo: 'Metabolism',
        expected: 'Clean feature flag state',
        actual: `Pruned ${prunedFlags} stale feature flags.`,
        severity: 'P2',
        recommendation: 'Feature flag bloat reduced via Silo 7 autonomous cleanup.',
      });
    }
  } catch (e) {
    logger.error(`[Metabolism] Feature flag cleanup failed (WS: ${workspaceId || 'GLOBAL'}):`, e);
  }

  // Repair 4: Low-Trust Mitigation & High-Trust Promotion (Perspective F: Metabolic Loop)
  try {
    const allAgents = (await AgentRegistry.getAllConfigs({ workspaceId })) as Record<
      string,
      IAgentConfig
    >;
    let disabledCount = 0;
    let promotedCount = 0;

    const { PromotionManager } = await import('../../lifecycle/promotion-manager');

    for (const [agentId, config] of Object.entries(allAgents)) {
      if (AgentRegistry.isBackboneAgent(agentId)) continue;

      const trustScore = config.trustScore ?? 100;

      // Case A: Critically Low Trust -> Disable (Mitigation)
      const lowTrustThreshold = await ConfigManager.getTypedConfig('low_trust_threshold', 20, {
        workspaceId,
      });

      if (config.enabled !== false && trustScore < lowTrustThreshold) {
        const disabled = await AgentRegistry.disableAgentIfTrustLow(agentId, lowTrustThreshold, {
          workspaceId,
        });
        if (disabled) disabledCount++;
      }

      // Case B: Exceptionally High Trust -> Promote to AUTO (Perspective F)
      if (config.enabled !== false && config.evolutionMode !== EvolutionMode.AUTO) {
        const promoted = await PromotionManager.promoteAgentToAuto(agentId, trustScore, {
          workspaceId,
        });
        if (promoted) promotedCount++;
      }
    }

    if (disabledCount > 0 || promotedCount > 0) {
      logger.info(
        `[Metabolism] Trust Metabolism: Disabled ${disabledCount} low-trust agents, Promoted ${promotedCount} to AUTO mode (WS: ${workspaceId || 'GLOBAL'}).`
      );
      repairFindings.push({
        silo: 'Metabolism',
        expected: 'Trust-aligned agent modes',
        actual: `Trust Metabolism: Disabled ${disabledCount} low-trust agents, Promoted ${promotedCount} to AUTO mode.`,
        severity: 'P1',
        recommendation: 'Perspective F (Metabolic Loop) reinforced via autonomous mode shifting.',
      });
    }
  } catch (e) {
    logger.error('[Metabolism] Trust metabolism failed:', e);
  }

  // Repair 5: S3 Staging Reclamation (Silo 7)
  try {
    const reclaimed = await pruneStagingBucket({ workspaceId });
    if (reclaimed > 0) {
      repairFindings.push({
        silo: 'Metabolism',
        expected: 'Lean S3 staging storage',
        actual: `Reclaimed ${reclaimed} stale objects from staging bucket (Scope: ${workspaceId || 'GLOBAL'}).`,
        severity: 'P2',
        recommendation: 'Silo 7 (Regenerative Metabolism) S3 reclamation enforced.',
      });
    }
  } catch (e) {
    logger.error('[Metabolism] S3 reclamation failed:', e);
    repairFindings.push({
      silo: 'Metabolism',
      expected: 'S3 reclamation success',
      actual: `S3 reclamation failed: ${e instanceof Error ? e.message : String(e)}`,
      severity: 'P1',
      recommendation: 'Check IAM permissions for staging bucket to restore metabolic hygiene.',
    });
  }

  return repairFindings;
}

/**
 * Prunes stale objects from the staging bucket.
 */
export async function pruneStagingBucket(scope: { workspaceId?: string }): Promise<number> {
  const bucket = getStagingBucketName();
  if (!bucket || bucket === 'StagingBucket') return 0;

  try {
    const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } =
      await import('@aws-sdk/client-s3');
    const s3Client = new S3Client({});

    const retentionDays = await ConfigManager.getTypedConfig('staging_retention_days', 30, {
      workspaceId: scope.workspaceId,
    });
    let continuationToken: string | undefined;
    let prunedCount = 0;

    do {
      const listResponse = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: scope.workspaceId ? `workspaces/${scope.workspaceId}/` : undefined,
          ContinuationToken: continuationToken,
        })
      );

      const contents = listResponse.Contents ?? [];
      const toDelete = contents
        .filter((obj) => {
          if (!obj.LastModified || !obj.Key) return false;
          const ageDays = (Date.now() - obj.LastModified.getTime()) / (1000 * 60 * 60 * 24);
          return ageDays > retentionDays;
        })
        .map((obj) => ({ Key: obj.Key! }));

      if (toDelete.length > 0) {
        const deleteResponse = await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: toDelete },
          })
        );

        if (deleteResponse.Errors && deleteResponse.Errors.length > 0) {
          const errorMsgs = deleteResponse.Errors.map((e) => `${e.Key}: ${e.Code}`).join(', ');
          logger.warn(`[Metabolism] Partial failure during S3 reclamation: ${errorMsgs}`);
          prunedCount += deleteResponse.Deleted?.length ?? 0;
        } else {
          prunedCount += toDelete.length;
        }
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    return prunedCount;
  } catch (e) {
    logger.error(`[Metabolism] Error pruning staging bucket: ${e}`);
    throw e;
  }
}
