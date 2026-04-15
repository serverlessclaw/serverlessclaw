import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetabolismService } from '../lib/maintenance/metabolism';
import { AgentRegistry } from '../lib/registry/AgentRegistry';
import { MCPMultiplexer } from '../lib/mcp';
import * as GapOps from '../lib/memory/gap-operations';
import type { FailureEventPayload } from '../lib/schema/events';

// Mock dependencies
vi.mock('../lib/registry/AgentRegistry', () => ({
  AgentRegistry: {
    pruneLowUtilizationTools: vi.fn(),
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn(),
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
  setGap: vi.fn(),
}));

const { MockEvolutionScheduler } = vi.hoisted(() => ({
  MockEvolutionScheduler: class {
    scheduleAction = vi.fn().mockResolvedValue({ success: true });
  },
}));

vi.mock('../lib/safety/evolution-scheduler', () => ({
  EvolutionScheduler: MockEvolutionScheduler,
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
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

  describe('remediateDashboardFailure', () => {
    const mockFailurePayload: FailureEventPayload = {
      source: 'dashboard',
      userId: 'test-user',
      traceId: 'test-trace-id',
      taskId: 'test-task-id',
      initiatorId: 'test-initiator',
      depth: 0,
      sessionId: 'test-session',
      timestamp: Date.now(),
      agentId: 'test-agent',
      task: 'test-task',
      error: 'Test Error',
      attachments: [],
      metadata: {},
      userNotified: false,
    };

    it('should execute tool pruning if the error is related to tools', async () => {
      const toolFailure = { ...mockFailurePayload, error: 'Failed to find tool: search' };
      (AgentRegistry.pruneLowUtilizationTools as any).mockResolvedValue(1);

      const result = await MetabolismService.remediateDashboardFailure(
        mockMemory as any,
        toolFailure
      );

      expect(AgentRegistry.pruneLowUtilizationTools).toHaveBeenCalledWith(1);
      expect(result).toBeDefined();
      expect(result?.actual).toContain('Pruned stale/failing tool overrides');
    });

    it('should execute gap culling if the error is related to memory or gaps', async () => {
      const memoryFailure = { ...mockFailurePayload, error: 'Memory inconsistency in gap-123' };

      const result = await MetabolismService.remediateDashboardFailure(
        mockMemory as any,
        memoryFailure
      );

      expect(GapOps.cullResolvedGaps).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result?.actual).toContain('Culled resolved gaps');
    });

    it('should schedule an evolution and set a gap for complex errors', async () => {
      const complexFailure = { ...mockFailurePayload, error: 'Critical unhandled logic exception' };

      const result = await MetabolismService.remediateDashboardFailure(
        mockMemory as any,
        complexFailure
      );

      expect(result).toBeUndefined();
      expect(GapOps.setGap).toHaveBeenCalled();
    });
  });
});
