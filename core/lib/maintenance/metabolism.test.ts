import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetabolismService } from './metabolism';
import { AgentRegistry } from '../registry/AgentRegistry';
import { archiveStaleGaps, cullResolvedGaps, setGap } from '../memory/gap-operations';
import { FeatureFlags } from '../feature-flags';

// Mock dependencies
vi.mock('../registry/AgentRegistry', () => ({
  AgentRegistry: {
    pruneLowUtilizationTools: vi.fn().mockResolvedValue(0),
    pruneAgentTool: vi.fn().mockResolvedValue(false),
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn(),
  },
}));

vi.mock('../memory/gap-operations', () => ({
  archiveStaleGaps: vi.fn().mockResolvedValue(0),
  cullResolvedGaps: vi.fn().mockResolvedValue(0),
  setGap: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../feature-flags', () => ({
  FeatureFlags: {
    pruneStaleFlags: vi.fn().mockResolvedValue(0),
    clearCache: vi.fn(),
  },
}));

vi.mock('../safety/evolution-scheduler', () => ({
  EvolutionScheduler: class {
    scheduleAction = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../mcp/mcp-bridge', () => ({
  MCPBridge: {
    getToolsFromServer: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('MetabolismService', () => {
  const mockMemory = {
    workspaceId: 'ws-1',
    getScopedUserId: vi.fn((id) => `WS#ws-1#${id}`),
    queryItems: vi.fn(),
    putItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runMetabolismAudit', () => {
    it('should perform repairs when requested and workspaceId is provided', async () => {
      vi.mocked(AgentRegistry.pruneLowUtilizationTools).mockResolvedValueOnce(5);
      vi.mocked(archiveStaleGaps).mockResolvedValueOnce(2);
      vi.mocked(cullResolvedGaps).mockResolvedValueOnce(3);
      vi.mocked(FeatureFlags.pruneStaleFlags).mockResolvedValueOnce(2);

      const findings = await MetabolismService.runMetabolismAudit(mockMemory, {
        repair: true,
        workspaceId: 'ws-1',
      });

      expect(AgentRegistry.pruneLowUtilizationTools).toHaveBeenCalledWith('ws-1', 30);
      expect(archiveStaleGaps).toHaveBeenCalledWith(mockMemory, undefined, 'ws-1');
      expect(cullResolvedGaps).toHaveBeenCalledWith(mockMemory, undefined, 'ws-1');
      expect(FeatureFlags.pruneStaleFlags).toHaveBeenCalledWith(30);

      expect(findings.some((f) => f.actual.includes('Pruned 5'))).toBe(true);
      expect(findings.some((f) => f.actual.includes('Metabolized memory state'))).toBe(true);
      expect(findings.some((f) => f.actual.includes('Pruned 2 stale feature flags'))).toBe(true);
    });

    it('should fallback to native audit if MCP tools are missing', async () => {
      const findings = await MetabolismService.runMetabolismAudit(mockMemory, {
        workspaceId: 'ws-1',
      });

      // Should find at least the native scan finding
      expect(findings.some((f) => f.actual.includes('Scanning codebase'))).toBe(true);
    });
  });

  describe('remediateDashboardFailure', () => {
    it('should perform surgical pruning for tool errors', async () => {
      const failure = {
        traceId: 'trace-123',
        agentId: 'coder',
        error: "Tool 'github_createIssue' failed",
        userId: 'user-1',
        workspaceId: 'ws-1',
      };

      vi.mocked(AgentRegistry.pruneAgentTool).mockResolvedValueOnce(true);

      const finding = await MetabolismService.remediateDashboardFailure(mockMemory, failure as any);

      expect(AgentRegistry.pruneAgentTool).toHaveBeenCalledWith('coder', 'github_createIssue', {
        workspaceId: 'ws-1',
      });
      expect(finding?.actual).toContain('Pruned stale/failing tool overrides atomically');
    });

    it('should fallback to broad pruning if surgical pruning finds no tools', async () => {
      const failure = {
        traceId: 'trace-123',
        agentId: 'coder',
        error: "Tool 'unknown_tool' failed",
        userId: 'user-1',
        workspaceId: 'ws-1',
      };

      vi.mocked(AgentRegistry.getRawConfig).mockResolvedValueOnce([]); // No tools found
      vi.mocked(AgentRegistry.pruneLowUtilizationTools).mockResolvedValueOnce(1);

      const finding = await MetabolismService.remediateDashboardFailure(mockMemory, failure as any);

      expect(AgentRegistry.pruneLowUtilizationTools).toHaveBeenCalledWith('ws-1', 1);
      expect(finding?.actual).toContain('Pruned stale/failing tool overrides');
    });

    it('should schedule HITL for complex errors', async () => {
      const failure = {
        traceId: 'trace-123',
        agentId: 'coder',
        error: 'Unexpected database corruption',
        userId: 'user-1',
      };

      const finding = await MetabolismService.remediateDashboardFailure(mockMemory, failure as any);

      expect(finding).toBeUndefined(); // HITL doesn't return immediate finding
      expect(setGap).toHaveBeenCalledWith(
        mockMemory,
        'REMEDIATION-trace-123',
        expect.stringContaining('Immediate remediation required'),
        expect.anything()
      );
    });
  });
});
