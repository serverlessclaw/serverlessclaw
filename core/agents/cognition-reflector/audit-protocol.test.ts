import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSystemAudit } from './audit-protocol';
import { MCPMultiplexer } from '../../lib/mcp';

vi.mock('../../lib/mcp');
vi.mock('../../lib/logger');
vi.mock('../../lib/utils/bus');

describe('Audit Protocol - Metabolism Silo (MCP-based)', () => {
  let mockMemory: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      getAllGaps: vi.fn().mockResolvedValue([]),
      getFailurePatterns: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue([]),
    };

    // Mock MCPMultiplexer.getToolsFromServer
    (MCPMultiplexer.getToolsFromServer as any).mockResolvedValue([
      {
        name: 'metabolism_audit',
        execute: vi.fn().mockResolvedValue({
          findings: [
            {
              expected: 'Lean swarm',
              actual: '[Swarm Debt] Unused tools found',
              severity: 'P2',
              recommendation: 'Prune tools',
            },
          ],
          debtMarkers: 25,
        }),
      },
    ]);
  });

  it('should identify metabolism issues via MCP correctly', async () => {
    const report = await runSystemAudit(mockMemory, 'TEST');
    const metabolismFindings = report.findings.filter((f) => f.silo === 'Metabolism');

    expect(metabolismFindings.length).toBeGreaterThan(0);
    expect(metabolismFindings.some((f) => f.actual.includes('[Swarm Debt]'))).toBe(true);
  });

  it('should detect technical debt markers via MCP', async () => {
    const report = await runSystemAudit(mockMemory, 'TEST');
    const metabolismFindings = report.findings.filter((f) => f.silo === 'Metabolism');

    expect(metabolismFindings.some((f) => f.actual.includes('[Codebase Debt]'))).toBe(true);
  });

  it('should report P1 finding when MCP tools are missing', async () => {
    (MCPMultiplexer.getToolsFromServer as any).mockResolvedValue([]);

    const report = await runSystemAudit(mockMemory, 'TEST');
    const metabolismFindings = report.findings.filter((f) => f.silo === 'Metabolism');

    // FIXED: Now reports P1 finding instead of silent empty
    expect(metabolismFindings.length).toBe(1);
    expect(metabolismFindings[0].severity).toBe('P1');
    expect(metabolismFindings[0].actual).toContain('No metabolism_audit');
  });

  it('should report P1 finding when MCP execution fails', async () => {
    (MCPMultiplexer.getToolsFromServer as any).mockRejectedValue(new Error('Connection refused'));

    const report = await runSystemAudit(mockMemory, 'TEST');
    const metabolismFindings = report.findings.filter((f) => f.silo === 'Metabolism');

    // FIXED: Now reports P1 finding instead of silent empty
    expect(metabolismFindings.length).toBe(1);
    expect(metabolismFindings[0].severity).toBe('P1');
    expect(metabolismFindings[0].actual).toContain('failed');
  });
});
