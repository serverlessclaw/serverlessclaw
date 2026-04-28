import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetabolismService } from './metabolism';
import { AgentRegistry } from '../registry/AgentRegistry';
import { archiveStaleGaps, cullResolvedGaps, setGap } from '../memory/gap-operations';
import { FeatureFlags } from '../feature-flags';

// Mock dependencies
vi.mock('../registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn().mockResolvedValue(20),
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn(),
    atomicRemoveFromMap: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../registry/AgentRegistry', () => ({
  AgentRegistry: {
    isBackboneAgent: vi.fn().mockReturnValue(false),
    getAllConfigs: vi.fn().mockResolvedValue({}),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    pruneLowUtilizationTools: vi.fn().mockResolvedValue(0),
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

const mockS3Send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mockS3Send;
  },
  ListObjectsV2Command: class {
    constructor(public input: any) {}
  },
  DeleteObjectsCommand: class {
    constructor(public input: any) {}
  },
}));

vi.mock('../config/config-defaults', () => ({
  getConfigValue: vi.fn().mockReturnValue(30),
  CONFIG_DEFAULTS: {},
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../utils/resource-helpers', () => ({
  getStagingBucketName: vi.fn().mockReturnValue('real-staging-bucket'),
  getKnowledgeBucketName: vi.fn().mockReturnValue('real-knowledge-bucket'),
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

    it('should reclaim S3 staging objects', async () => {
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'old-file', LastModified: new Date(Date.now() - 40 * 24 * 3600 * 1000) },
          { Key: 'new-file', LastModified: new Date() },
        ],
      });
      mockS3Send.mockResolvedValueOnce({}); // Delete response

      const findings = await MetabolismService.runMetabolismAudit(mockMemory, {
        repair: true,
        workspaceId: 'ws-1',
      });

      expect(mockS3Send).toHaveBeenCalled();
      expect(findings.some((f) => f.actual.includes('Reclaimed 1 stale objects'))).toBe(true);
    });

    it('should handle S3 pagination when pruning staging bucket', async () => {
      // First page with a continuation token
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'page1-old', LastModified: new Date(Date.now() - 40 * 24 * 3600 * 1000) },
        ],
        NextContinuationToken: 'token-123',
      });
      // Second page
      mockS3Send.mockResolvedValueOnce({}); // Delete response for page 1
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'page2-old', LastModified: new Date(Date.now() - 40 * 24 * 3600 * 1000) },
        ],
      });
      mockS3Send.mockResolvedValueOnce({}); // Delete response for page 2

      const findings = await MetabolismService.runMetabolismAudit(mockMemory, {
        repair: true,
        workspaceId: 'ws-1',
      });

      expect(mockS3Send).toHaveBeenCalledTimes(4); // List1, Delete1, List2, Delete2
      expect(findings.some((f) => f.actual.includes('Reclaimed 2 stale objects'))).toBe(true);
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

      const { ConfigManager } = await import('../registry/config');
      vi.mocked(ConfigManager.atomicRemoveFromMap).mockResolvedValueOnce(undefined);

      const finding = await MetabolismService.remediateDashboardFailure(mockMemory, failure as any);

      expect(ConfigManager.atomicRemoveFromMap).toHaveBeenCalledWith(
        'agent_tool_overrides',
        'coder',
        ['github_createIssue'],
        { workspaceId: 'ws-1' }
      );
      expect(finding?.actual).toContain('Pruned stale/failing tool overrides atomically');
    });

    it('should fallback to broad pruning if surgical pruning finds no tools', async () => {
      const failure = {
        traceId: 'trace-123',
        agentId: 'coder',
        error: 'Registry override failure',
        userId: 'user-1',
        workspaceId: 'ws-1',
      };

      const { ConfigManager } = await import('../registry/config');
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValueOnce([]); // No tools found
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
        workspaceId: 'ws-1',
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
