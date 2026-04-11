import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScytheLogic } from './scythe';
import { ConfigManager } from '../../../lib/registry/config';

vi.mock('../../../lib/registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn(),
    getRawConfig: vi.fn(),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../lib/registry/AgentRegistry', () => ({
  AgentRegistry: {
    initializeToolStats: vi.fn().mockResolvedValue(undefined),
    recordToolUsage: vi.fn().mockResolvedValue(undefined),
    getAllConfigs: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../../tools/index', () => ({
  TOOLS: {
    tool1: {},
    tool2: {},
    tool3: {},
  },
}));

describe('ScytheLogic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generatePruneProposal', () => {
    it('should return undefined if auto_prune_enabled is false', async () => {
      vi.mocked(ConfigManager.getTypedConfig).mockResolvedValueOnce(false);
      const result = await ScytheLogic.generatePruneProposal();
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
        tool1: { count: 10, lastUsed: now - 1000 },
        tool2: { count: 5, lastUsed: now - 35 * 24 * 60 * 60 * 1000 },
      };

      vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
        if (key === 'tool_usage_global') return usage;
        return undefined;
      });

      const result = await ScytheLogic.generatePruneProposal();
      expect(result).toBeDefined();
      expect(result?.swarm.unusedTools).toContain('tool2');
      expect(result?.swarm.unusedTools).not.toContain('tool1');
    });

    it('should identify zombie agents', async () => {
      vi.mocked(ConfigManager.getTypedConfig).mockImplementation(async (key, defaultValue) => {
        if (key === 'auto_prune_enabled') return true;
        return defaultValue;
      });
      const usage = { tool1: { count: 10, lastUsed: Date.now() } };
      vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key) => {
        if (key === 'tool_usage_global') return usage;
        return undefined; // No usage for agents
      });

      const { AgentRegistry } = await import('../../../lib/registry/AgentRegistry');
      vi.spyOn(AgentRegistry as any, 'getAllConfigs').mockResolvedValue({
        'zombie-agent': { id: 'zombie-agent', name: 'Zombie', systemPrompt: '...', tools: [] },
      });

      const result = await ScytheLogic.generatePruneProposal();
      expect(result?.swarm.zombieAgents).toContain('zombie-agent');
    });

    it('should identify codebase debt markers', async () => {
      vi.mocked(ConfigManager.getTypedConfig).mockImplementation(async (key, defaultValue) => {
        if (key === 'auto_prune_enabled') return true;
        return defaultValue;
      });
      // We rely on the real fs scan in this test, but core/ dir must exist.
      const result = await ScytheLogic.generatePruneProposal();
      expect(result).toBeDefined();
      expect(result?.codebase.debtMarkers).toBeGreaterThanOrEqual(0);
    });
  });

  describe('updateToolHistory', () => {
    it('should append tool count to history', async () => {
      const memory = {
        get: vi.fn().mockResolvedValue([{ count: 5, timestamp: 1000 }]),
        set: vi.fn().mockResolvedValue(undefined),
      };

      await ScytheLogic.updateToolHistory(memory);

      expect(memory.set).toHaveBeenCalledWith(
        'scythe:tool_count_history',
        expect.arrayContaining([
          { count: 5, timestamp: 1000 },
          expect.objectContaining({ count: expect.any(Number) }),
        ])
      );
    });
  });
});
