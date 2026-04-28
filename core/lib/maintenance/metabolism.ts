import { logger } from '../logger';
import { MCPBridge } from '../mcp/mcp-bridge';
import { BaseMemoryProvider } from '../memory/base';
import { getStagingBucketName } from '../utils/resource-helpers';
import { getConfigValue } from '../config/config-defaults';
import { AuditFinding } from '../../agents/cognition-reflector/lib/audit-definitions';
import { AgentRegistry } from '../registry/AgentRegistry';
import { archiveStaleGaps, cullResolvedGaps, setGap } from '../memory/gap-operations';
import { InsightCategory } from '../types/memory';
import { EvolutionScheduler } from '../safety/evolution-scheduler';
import { FailureEventPayload } from '../schema/events';
import { FeatureFlags } from '../feature-flags';
import { ConfigManager } from '../registry/config';
import { DYNAMO_KEYS } from '../constants';

/**
 * MetabolismService coordinates the "Regenerative Metabolism" silo.
 * It combines observation (auditing) with autonomous repairs (pruning/culling).
 *
 * Regenerative Metabolism Cycle:
 * ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
 * │  Observation │─────▶│ Evaluation   │─────▶│ Remediation  │
 * │ (AST Scans)  │      │ (Trust/Usage)│      │ (Pruning)    │
 * └──────────────┘      └──────────────┘      └──────────────┘
 *        ▲                                            │
 *        └────────────────────────────────────────────┘
 */
export class MetabolismService {
  /**
   * Runs a metabolism audit and performs regenerative repairs if requested.
   * Following the "Perform while Auditing" philosophy.
   */
  static async runMetabolismAudit(
    memory: BaseMemoryProvider,
    options: {
      repair?: boolean;
      workspaceId?: string;
      teamId?: string;
      staffId?: string;
    } = {}
  ): Promise<AuditFinding[]> {
    if (!options.workspaceId) {
      throw new Error('[Metabolism] Mandatory workspaceId missing in runMetabolismAudit');
    }
    const findings: AuditFinding[] = [];
    const scope = {
      workspaceId: options.workspaceId,
      teamId: options.teamId,
      staffId: options.staffId,
    };
    logger.info(`[Metabolism] Starting regenerative audit for WS: ${options.workspaceId}`);

    // 1. Perform automated repairs for stateless state (Registry/Memory)
    if (options.repair) {
      const repairs = await this.executeRepairs(memory, scope);
      findings.push(...repairs);
    }

    // 2. Delegate to AIReady (AST) MCP if available
    const mcpFindings = await this.runMcpAudit(scope);
    findings.push(...mcpFindings);

    // 3. Fallback to native audit if MCP failed or returned no tools
    const hasMcpFail = mcpFindings.some(
      (f) => f.recommendation.includes('Ensure AST server') || f.expected === 'MCP audit success'
    );
    if (mcpFindings.length === 0 || hasMcpFail) {
      const nativeFindings = await this.runNativeAudit(scope);
      findings.push(...nativeFindings);
    }

    return findings;
  }

  /**
   * Executes autonomous repairs on system state.
   */
  private static async executeRepairs(
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
      const allAgents = await AgentRegistry.getAllConfigs({ workspaceId: scope.workspaceId });
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
      const reclaimed = await this.pruneStagingBucket(scope);
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
    }

    return repairFindings;
  }

  /**
   * Prunes stale objects from the staging bucket.
   * Requirement: workspaceId MUST be provided to prevent global S3 traversal.
   */
  private static async pruneStagingBucket(scope: { workspaceId: string }): Promise<number> {
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

      const retentionDays = getConfigValue('STAGING_RETENTION_DAYS');
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
      logger.error('[Metabolism] Staging bucket pruning failed:', e);
      return 0;
    }
  }

  /**
   * Runs the codebase audit via AIReady (AST) MCP server.
   */
  private static async runMcpAudit(scope: {
    workspaceId?: string;
    teamId?: string;
    staffId?: string;
  }): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];
    try {
      const astTools = await MCPBridge.getToolsFromServer('ast', '');
      const auditTool = astTools.find((t: { name: string }) => {
        const name = t.name.toLowerCase();
        return name.includes('metabolism') || name.includes('audit');
      });

      if (!auditTool) {
        findings.push({
          silo: 'Metabolism',
          expected: 'MCP-based metabolism audit available',
          actual: 'No metabolism_audit tool found in AIReady (AST) server',
          severity: 'P1',
          recommendation: 'Ensure AST server is deployed or implement native codebase scanner.',
        });
        return findings;
      }

      const auditPath = process.cwd() + '/core';
      const result = await auditTool.execute({
        path: auditPath,
        workspaceId: scope.workspaceId,
        teamId: scope.teamId,
        staffId: scope.staffId,
        includeTelemetry: true,
        depth: 'full',
      });

      if (result && typeof result === 'object') {
        const data = (
          'metadata' in result ? (result.metadata as Record<string, unknown>) : result
        ) as Record<string, unknown>;
        const mcpFindings = (data.findings || data.results || []) as Array<{
          expected?: string;
          actual?: string;
          message?: string;
          severity?: string;
          recommendation?: string;
          fix?: string;
        }>;
        if (Array.isArray(mcpFindings)) {
          const validSeverities = ['P0', 'P1', 'P2', 'P3'];
          for (const f of mcpFindings) {
            const severityValue = f.severity ?? 'P2';
            findings.push({
              silo: 'Metabolism',
              expected: f.expected || 'Lean, optimized system state',
              actual: f.actual || f.message || 'Bloat/Debt detected by AIReady',
              severity: validSeverities.includes(severityValue)
                ? (severityValue as 'P0' | 'P1' | 'P2' | 'P3')
                : 'P2',
              recommendation: f.recommendation || f.fix || 'Review AIReady report for details.',
            });
          }
        }
      }
    } catch (e) {
      logger.warn('[Metabolism] MCP audit failed, will trigger native fallback:', e);
      findings.push({
        silo: 'Metabolism',
        expected: 'MCP audit success',
        actual: `MCP audit threw: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'P2',
        recommendation: 'Check MCP server availability and connectivity.',
      });
    }
    return findings;
  }

  /**
   * Performs immediate remediation for a detected dashboard failure.
   * Sh7: Live remediation bridge for real-time system stability.
   */
  static async remediateDashboardFailure(
    memory: BaseMemoryProvider,
    failure: FailureEventPayload
  ): Promise<AuditFinding | undefined> {
    const workspaceId = (failure as Record<string, unknown>).workspaceId as string | undefined;
    if (!workspaceId) {
      logger.warn('[Metabolism] Skipping real-time remediation: missing workspaceId');
      return undefined;
    }
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
        pruned = true;
      }

      if (!pruned && workspaceId) {
        // Fallback to broad pruning using atomic utilization check
        const prunedCount = await AgentRegistry.pruneLowUtilizationTools(workspaceId, 1);
        pruned = prunedCount > 0;
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
        const reclaimed = await this.pruneStagingBucket({ workspaceId });
        if (reclaimed > 0) {
          return {
            silo: 'Metabolism',
            expected: 'Accessible staging artifacts',
            actual: `Real-time repair: Metabolized staging bucket to clear access/stale inconsistencies.`,
            severity: 'P2',
            recommendation: 'S3 state reset performed. Retrying operation may now succeed.',
          };
        }
      }
    }

    // Strategy 2: Memory/Gap inconsistencies
    if (error.includes('memory') || error.includes('gap')) {
      await cullResolvedGaps(memory, undefined, workspaceId);
      return {
        silo: 'Metabolism',
        expected: 'Clean memory state',
        actual: `Real-time repair: Culled resolved gaps to resolve memory inconsistency.`,
        severity: 'P2',
        recommendation: 'Autonomous repair executed successfully.',
      };
    }

    // Fallback: Schedule HITL evolution for complex/unknown errors
    logger.warn(
      `[Metabolism] Complex error detected, scheduling HITL remediation: ${failure.error}`
    );
    const scheduler = new EvolutionScheduler(memory);
    await scheduler.scheduleAction({
      agentId: failure.agentId || 'unknown',
      action: 'REMEDIATION',
      reason: `Unresolved dashboard error: ${failure.error}`,
      timeoutMs: 3600000, // 1 hour
      traceId: failure.traceId,
      userId: failure.userId,
      workspaceId,
    });

    // Also propagate as a strategic gap for visibility
    await setGap(
      memory,
      `REMEDIATION-${failure.traceId}`,
      `Immediate remediation required: ${failure.error}`,
      { category: InsightCategory.STRATEGIC_GAP, urgency: 5, impact: 8 }
    );

    return undefined;
  }

  /**
   * Runs naive native checks for common debt markers.
   * Uses in-memory file scanning instead of shell commands for serverless compatibility.
   */
  private static async runNativeAudit(_scope?: {
    workspaceId?: string;
    teamId?: string;
    staffId?: string;
  }): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];

    findings.push({
      silo: 'Metabolism',
      expected: 'Native technical debt scan performed',
      actual: 'Scanning codebase for P3 debt markers (TODO/FIXME)...',
      severity: 'P3',
      recommendation: 'AIReady MCP unavailable. Falling back to native debt markers.',
    });

    try {
      const corePath = process.cwd() + '/core';
      const { readFile, readdir, stat } = await import('fs/promises');
      const { join } = await import('path');

      /**
       * MetabolismService - Integrity Diagram
       * ------------------------------------
       * MCP Scanner (AIReady) -> Native Fallback (File Audit)
       *       |                       |
       *       +-----> Remediation <---+
       *                   |
       *            [HITL Scheduler]
       */

      const scanDir = async (dir: string, depth: number = 0): Promise<string[]> => {
        const maxDepth = getConfigValue('AUDIT_SCAN_DEPTH');
        if (depth > maxDepth) return [];
        const results: string[] = [];
        try {
          const entries = await readdir(dir);
          for (const entry of entries) {
            const fullPath = join(dir, entry);
            const s = await stat(fullPath);
            if (s.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
              results.push(...(await scanDir(fullPath, depth + 1)));
            } else if (s.isFile() && (entry.endsWith('.ts') || entry.endsWith('.js'))) {
              try {
                const content = await readFile(fullPath, 'utf-8');
                if (content.includes('TODO') || content.includes('FIXME')) {
                  results.push(fullPath);
                }
              } catch {
                // Ignore file read errors during audit scan
              }
            }
          }
        } catch {
          // Ignore directory read errors during audit scan
        }
        return results;
      };

      const filesWithMarkers = await scanDir(corePath);
      if (filesWithMarkers.length > 0) {
        findings.push({
          silo: 'Metabolism',
          expected: 'Zero technical debt markers in core paths',
          actual: `Native scan: Found ${filesWithMarkers.length} files with debt markers (TODO/FIXME).`,
          severity: 'P3',
          recommendation: 'Review detected markers and schedule refactoring sprints.',
        });
      }
    } catch (e) {
      logger.warn('[Metabolism] Native debt scan failed:', e);
    }
    return findings;
  }
}
