import { logger } from '../logger';
import { BaseMemoryProvider } from '../memory/base';
import { AuditFinding } from '../../agents/cognition-reflector/lib/audit-definitions';
import { FailureEventPayload } from '../schema/events';

/**
 * MetabolismService coordinates the "Regenerative Metabolism" silo.
 * It combines observation (auditing) with autonomous repairs (pruning/culling).
 */
export class MetabolismService {
  /**
   * Runs a metabolism audit and performs regenerative repairs if requested.
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
    const findings: AuditFinding[] = [];
    const scope = {
      workspaceId: options.workspaceId,
      teamId: options.teamId,
      staffId: options.staffId,
    };
    logger.info(
      `[Metabolism] Starting regenerative audit for scope: ${options.workspaceId || 'GLOBAL'}`
    );

    // 1. Perform automated repairs for stateless state
    if (options.repair) {
      const { executeRepairs } = await import('./metabolism/repairs');
      const repairs = await executeRepairs(memory, scope);
      findings.push(...repairs);
    }

    // 2. Delegate to AIReady (AST) MCP if available
    const { runMcpAudit, runNativeAudit } = await import('./metabolism/audit');
    const mcpFindings = await runMcpAudit(scope);
    findings.push(...mcpFindings);

    // 3. Fallback to native audit if MCP failed or returned no tools
    const hasMcpFail = mcpFindings.some(
      (f) => f.recommendation.includes('Ensure AST server') || f.expected === 'MCP audit success'
    );
    if (mcpFindings.length === 0 || hasMcpFail) {
      const nativeFindings = await runNativeAudit(scope);
      findings.push(...nativeFindings);
    }

    return findings;
  }

  /**
   * Performs immediate remediation for a detected dashboard failure.
   */
  static async remediateDashboardFailure(
    memory: BaseMemoryProvider,
    failure: FailureEventPayload
  ): Promise<AuditFinding | undefined> {
    const { remediateDashboardFailure: remediate } = await import('./metabolism/remediation');
    return remediate(memory, failure);
  }
}
