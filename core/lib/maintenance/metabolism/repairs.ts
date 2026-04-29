import { logger } from '../../logger';
import { BaseMemoryProvider } from '../../memory/base';
import { IAgentConfig } from '../../types/index';
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
  scope: { workspaceId: string; teamId?: string; staffId?: string }
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
        actual: `Pruned ${pruned} low-utilization tools from agent overrides.`,
        severity: 'P2',
        recommendation: 'Principle 10 (Lean Evolution) enforced via registry pruning.',
      });
    }
  } catch (e) {
    logger.error('[Metabolism] Registry repair failed:', e);
    repairFindings.push({
      silo: 'Metabolism',
      expected: 'Agent registry repair completion',
      actual: `Registry repair failed: ${e instanceof Error ? e.message : String(e)}`,
      severity: 'P1',
      recommendation: 'Investigate DynamoDB connectivity or ConfigManager atomic operations.',
    });
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
    logger.error('[Metabolism] Memory repair failed:', e);
    repairFindings.push({
      silo: 'Metabolism',
      expected: 'Memory state repair completion',
      actual: `Memory repair failed: ${e instanceof Error ? e.message : String(e)}`,
      severity: 'P1',
      recommendation: 'Check MemoryProvider authorization and workspaceId isolation.',
    });
  }

  // Repair 3: Stale Feature Flags (Silo 7)
  try {
    const prunedFlags = await FeatureFlags.pruneStaleFlags(30);
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
    logger.error('[Metabolism] Feature flag cleanup failed:', e);
    repairFindings.push({
      silo: 'Metabolism',
      expected: 'Feature flag cleanup completion',
      actual: `Feature flag cleanup failed: ${e instanceof Error ? e.message : String(e)}`,
      severity: 'P2',
      recommendation: 'Check FeatureFlags and ConfigManager connectivity.',
    });
  }

  // Repair 4: Low-Trust Agent Mitigation (Perspective D: Trust Loop)
  try {
    const allAgents = (await AgentRegistry.getAllConfigs({
      workspaceId: scope.workspaceId,
    })) as Record<string, IAgentConfig>;
    let disabledCount = 0;
    for (const [agentId, config] of Object.entries(allAgents)) {
      const lowTrustThreshold = await ConfigManager.getTypedConfig('low_trust_threshold', 20, {
        workspaceId: scope.workspaceId,
      });

      if (
        !AgentRegistry.isBackboneAgent(agentId) &&
        config.enabled !== false &&
        (config.trustScore ?? 100) < lowTrustThreshold
      ) {
        logger.warn(
          `[Metabolism] Automatically disabling low-trust agent: ${agentId} (Score: ${config.trustScore})`
        );
        await AgentRegistry.saveConfig(
          agentId,
          { enabled: false },
          { workspaceId: scope.workspaceId }
        );
        disabledCount++;
      }
    }

    if (disabledCount > 0) {
      repairFindings.push({
        silo: 'Metabolism',
        expected: 'Trust-verified agent registry',
        actual: `Autonomously disabled ${disabledCount} critically low-trust agents.`,
        severity: 'P1',
        recommendation:
          'Perspective D (Trust Loop) reinforced. Review reputation logs for disabled agents.',
      });
    }
  } catch (e) {
    logger.error('[Metabolism] Trust metabolism failed:', e);
  }

  // Repair 5: S3 Staging Reclamation (Silo 7)
  try {
    const reclaimed = await pruneStagingBucket(scope);
    if (reclaimed > 0) {
      repairFindings.push({
        silo: 'Metabolism',
        expected: 'Lean S3 staging storage',
        actual: `Reclaimed ${reclaimed} stale objects from staging bucket for WS: ${workspaceId}.`,
        severity: 'P2',
        recommendation: 'Silo 7 (Regenerative Metabolism) S3 reclamation enforced.',
      });
    }
  } catch (e) {
    logger.error('[Metabolism] S3 reclamation failed:', e);
    repairFindings.push({
      silo: 'Metabolism',
      expected: 'S3 staging reclamation completion',
      actual: `S3 reclamation failed: ${e instanceof Error ? e.message : String(e)}`,
      severity: 'P1',
      recommendation:
        'Check S3 permissions (DeleteObjects) and IAM policy for the metabolism role.',
    });
  }

  return repairFindings;
}

/**
 * Prunes stale objects from the staging bucket.
 */
export async function pruneStagingBucket(scope: { workspaceId: string }): Promise<number> {
  const bucket = getStagingBucketName();
  if (!bucket || bucket === 'StagingBucket') return 0;
  if (!scope.workspaceId) {
    logger.error('[Metabolism] Mandatory workspaceId missing in pruneStagingBucket');
    return 0;
  }

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
          Prefix: `workspaces/${scope.workspaceId}/`,
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
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: toDelete },
          })
        );
        prunedCount += toDelete.length;
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    return prunedCount;
  } catch (e) {
    logger.error(`[Metabolism] Error pruning staging bucket: ${e}`);
    throw e;
  }
}
