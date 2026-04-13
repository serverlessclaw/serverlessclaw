import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetabolismService } from '../lib/maintenance/metabolism';
import { AgentRegistry } from '../lib/registry/AgentRegistry';
import { MCPMultiplexer } from '../lib/mcp';
import * as GapOps from '../lib/memory/gap-operations';

// Mock dependencies
vi.mock('../lib/registry/AgentRegistry', () => ({
  AgentRegistry: {
    pruneLowUtilizationTools: vi.fn(),
  },
}));

vi.mock('../lib/mcp', () => ({
  MCPMultiplexer: {
    getToolsFromServer: vi.fn(),
  },
}));

vi.mock('../lib/memory/gap-operations', () => ({
  archiveStaleGaps: vi.fn(),
  cullResolvedGaps: vi.fn(),
}));

describe('MetabolismService', () => {
  const mockMemory = { type: 'MockMemory' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runMetabolismAudit', () => {
    it('should skip repairs if repair option is false', async () => {
      vi.mocked(MCPMultiplexer.getToolsFromServer).mockResolvedValue([]);

      await MetabolismService.runMetabolismAudit(mockMemory as any, { repair: false });

      expect(AgentRegistry.pruneLowUtilizationTools).not.toHaveBeenCalled();
      expect(GapOps.archiveStaleGaps).not.toHaveBeenCalled();
      expect(GapOps.cullResolvedGaps).not.toHaveBeenCalled();
    });

    it('should execute repairs when repair option is true', async () => {
      vi.mocked(AgentRegistry.pruneLowUtilizationTools).mockResolvedValue(5);
      vi.mocked(GapOps.archiveStaleGaps).mockResolvedValue(2);
      vi.mocked(GapOps.cullResolvedGaps).mockResolvedValue(3);
      vi.mocked(MCPMultiplexer.getToolsFromServer).mockResolvedValue([]);

      const findings = await MetabolismService.runMetabolismAudit(mockMemory as any, {
        repair: true,
      });
      expect(AgentRegistry.pruneLowUtilizationTools).toHaveBeenCalledWith(30);
      expect(GapOps.archiveStaleGaps).toHaveBeenCalledWith(mockMemory);
      expect(GapOps.cullResolvedGaps).toHaveBeenCalledWith(mockMemory);

      // Verify repair findings are present
      const prunedFinding = findings.find((f) => f.actual.includes('Pruned 5'));
      const memoryFinding = findings.find(
        (f) => f.actual.includes('archived 2') && f.actual.includes('culled 3')
      );

      expect(prunedFinding).toBeDefined();
      expect(memoryFinding).toBeDefined();
      expect(prunedFinding?.severity).toBe('P2');
    });

    it('should trigger native audit fallback if MCP is unavailable', async () => {
      vi.mocked(MCPMultiplexer.getToolsFromServer).mockRejectedValue(new Error('MCP Down'));

      const findings = await MetabolismService.runMetabolismAudit(mockMemory as any, {
        repair: false,
      });

      expect(findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ expected: 'Native metabolism fallback check active' }),
        ])
      );
    });

    it('should process findings from AIReady MCP metabolism_audit tool', async () => {
      const mockMcpFindings = [
        { expected: 'Target A', actual: 'Current A', severity: 'P2', recommendation: 'Fix A' },
      ];

      vi.mocked(MCPMultiplexer.getToolsFromServer).mockResolvedValue([
        {
          name: 'metabolism_audit',
          execute: vi.fn().mockResolvedValue({ findings: mockMcpFindings }),
        } as any,
      ]);

      const findings = await MetabolismService.runMetabolismAudit(mockMemory as any, {
        repair: false,
      });

      expect(findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ expected: 'Target A', severity: 'P2' })])
      );
    });

    it('should handle native fallback finding if MCP tool is missing', async () => {
      vi.mocked(MCPMultiplexer.getToolsFromServer).mockResolvedValue([
        { name: 'some_other_tool', execute: vi.fn() } as any,
      ]);

      const findings = await MetabolismService.runMetabolismAudit(mockMemory as any, {
        repair: false,
      });

      expect(findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actual: 'No metabolism_audit tool found in AIReady (AST) server',
          }),
          expect.objectContaining({ expected: 'Native metabolism fallback check active' }),
        ])
      );
    });
  });
});
