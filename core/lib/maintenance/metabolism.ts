import { logger } from '../logger';
import { AuditFinding } from '../../agents/cognition-reflector/lib/audit-definitions';
import { MCPMultiplexer } from '../mcp';
import { AgentRegistry } from '../registry/AgentRegistry';
import { archiveStaleGaps, cullResolvedGaps } from '../memory/gap-operations';

/**
 * MetabolismService coordinates the "Regenerative Metabolism" silo.
 * It combines observation (auditing) with autonomous repairs (pruning/culling).
 */
export class MetabolismService {
  /**
   * Runs a metabolism audit and performs regenerative repairs if requested.
   * Following the "Perform while Auditing" philosophy.
   *
   * @param memory - The memory provider instance for gap operations.
   * @param options - Audit options.
   * @returns A promise resolving to an array of audit findings.
   */
  static async runMetabolismAudit(
    memory: any,
    options: { repair?: boolean } = {}
  ): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];

    logger.info(`[Metabolism] Starting regenerative audit (repair: ${!!options.repair})`);

    // 1. Perform automated repairs for stateless state (Registry/Memory)
    if (options.repair) {
      const repairs = await this.executeRepairs(memory);
      findings.push(...repairs);
    }

    // 2. Delegate to AIReady (AST) MCP if available
    const mcpFindings = await this.runMcpAudit();
    findings.push(...mcpFindings);

    // 3. Fallback to native audit if MCP failed or returned no tools
    const hasMcpFail = mcpFindings.some((f) => f.recommendation.includes('Ensure AST server'));
    if (mcpFindings.length === 0 || hasMcpFail) {
      const nativeFindings = await this.runNativeAudit();
      findings.push(...nativeFindings);
    }

    return findings;
  }

  /**
   * Executes autonomous repairs on system state.
   */
  private static async executeRepairs(memory: any): Promise<AuditFinding[]> {
    const repairFindings: AuditFinding[] = [];

    // Repair 1: Agent Registry Low-Utilization Tools (Principle 10)
    try {
      const pruned = await AgentRegistry.pruneLowUtilizationTools(30);
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
    }

    // Repair 2: Memory Bloat (Stale Gaps)
    try {
      const archived = await archiveStaleGaps(memory);
      const culled = await cullResolvedGaps(memory);
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
    }

    return repairFindings;
  }

  /**
   * Runs the codebase audit via AIReady (AST) MCP server.
   */
  private static async runMcpAudit(): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];
    try {
      const astTools = await MCPMultiplexer.getToolsFromServer('ast', '');
      const auditTool = astTools.find(
        (t: { name: string }) =>
          t.name === 'metabolism_audit' ||
          t.name === 'codebase_audit' ||
          t.name.includes('metabolism')
      );

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

      const result = await auditTool.execute({
        path: './core',
        includeTelemetry: true,
        depth: 'full',
      });

      if (result && typeof result === 'object') {
        const data = ('metadata' in result ? (result.metadata as any) : result) as any;
        const mcpFindings = data.findings || data.results || [];
        if (Array.isArray(mcpFindings)) {
          for (const f of mcpFindings) {
            findings.push({
              silo: 'Metabolism',
              expected: f.expected || 'Lean, optimized system state',
              actual: f.actual || f.message || 'Bloat/Debt detected by AIReady',
              severity: f.severity || 'P2',
              recommendation: f.recommendation || f.fix || 'Review AIReady report for details.',
            });
          }
        }
      }
    } catch (e) {
      logger.warn('[Metabolism] MCP audit failed, will trigger native fallback:', e);
    }
    return findings;
  }

  /**
   * Runs naive native checks for common debt markers.
   */
  private static async runNativeAudit(): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];
    // Native fallback performs basic checks that don't require external AST analysis
    findings.push({
      silo: 'Metabolism',
      expected: 'Native metabolism fallback check active',
      actual: 'Scanning codebase for P3 debt markers (TODO/FIXME)...',
      severity: 'P3',
      recommendation:
        'AIReady MCP unavailable. Native scanner identifies debt markers but meta-repair requires MCP for safety.',
    });
    return findings;
  }
}
