import { logger } from '../../logger';
import { AuditFinding } from '../../../agents/cognition-reflector/lib/audit-definitions';

/**
 * Runs the codebase audit via AIReady (AST) MCP server.
 */
export async function runMcpAudit(scope: {
  workspaceId?: string;
  teamId?: string;
  staffId?: string;
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  try {
    const { MCPBridge } = await import('../../mcp/mcp-bridge');
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
 * Runs naive native checks for common debt markers.
 */
export async function runNativeAudit(_scope?: {
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

    const { ConfigManager } = await import('../../registry/config');
    const scanDir = async (dir: string, depth: number = 0): Promise<string[]> => {
      const maxDepth = await ConfigManager.getTypedConfig('audit_scan_depth', 3, {
        workspaceId: _scope?.workspaceId,
      });
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
              // Ignore file read errors
            }
          }
        }
      } catch {
        // Ignore directory errors
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
    logger.warn(
      `[Metabolism] Native debt scan failed (WS: ${_scope?.workspaceId || 'GLOBAL'}):`,
      e
    );
  }
  return findings;
}
