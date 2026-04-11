import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolPruner } from './pruning';
import { ConfigManager } from '../registry/config';

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn(),
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../tools/index', () => ({
  TOOLS: {
    tool1: {},
    tool2: {},
    tool3: {},
  },
}));

describe('ToolPruner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generatePruneProposal', () => {
    it('should return undefined if auto_prune_enabled is false', async () => {
      vi.mocked(ConfigManager.getTypedConfig).mockResolvedValueOnce(false);
      const result = await ToolPruner.generatePruneProposal();
      expect(result).toBeUndefined();
    });

    it('should identify unused tools', async () => {
      vi.mocked(ConfigManager.getTypedConfig).mockImplementation(async (key, defaultValue) => {
        if (key === 'auto_prune_enabled') return true;
        if (key === 'tool_prune_threshold_days') return 30;
        return defaultValue;
      });

      const now = Date.now();
      const usage = {
        tool1: { count: 10, lastUsed: now - 1000 }, // Recently used
        tool2: { count: 5, lastUsed: now - 35 * 24 * 60 * 60 * 1000 }, // Stale (35 days ago)
        // tool3 is missing -> Never used
      };

      vi.mocked(ConfigManager.getRawConfig).mockResolvedValueOnce(usage);

      const result = await ToolPruner.generatePruneProposal();
      expect(result).toBeDefined();
      // tool2 is stale (lastUsed 35 days ago, firstRegistered falls back to lastUsed - outside grace period)
      expect(result?.unusedTools).toContain('tool2');
      // tool3 has NO usage record at all → skipped (not flagged) to avoid pruning newly-added tools
      expect(result?.unusedTools).not.toContain('tool3');
      expect(result?.unusedTools).not.toContain('tool1');
    });

    it('should return undefined if all tools are recently used', async () => {
      vi.mocked(ConfigManager.getTypedConfig).mockImplementation(async (key, defaultValue) => {
        if (key === 'auto_prune_enabled') return true;
        if (key === 'tool_prune_threshold_days') return 30;
        return defaultValue;
      });

      const now = Date.now();
      const usage = {
        tool1: { count: 10, lastUsed: now - 1000 },
        tool2: { count: 5, lastUsed: now - 1000 },
        tool3: { count: 1, lastUsed: now - 1000 },
      };

      vi.mocked(ConfigManager.getRawConfig).mockResolvedValueOnce(usage);

      const result = await ToolPruner.generatePruneProposal();
      expect(result).toBeUndefined();
    });
  });

  describe('recordPruneProposal', () => {
    it('should save the proposal to the ConfigTable', async () => {
      const proposal = {
        unusedTools: ['tool1', 'tool2'],
        thresholdDays: 30,
      };

      await ToolPruner.recordPruneProposal(proposal);
      expect(ConfigManager.saveRawConfig).toHaveBeenCalledWith(
        'pending_prune_proposal',
        expect.objectContaining({
          unusedTools: proposal.unusedTools,
          status: 'PENDING_REVIEW',
        })
      );
    });
  });
});
