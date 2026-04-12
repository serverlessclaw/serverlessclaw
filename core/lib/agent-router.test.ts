import { describe, it, expect, vi } from 'vitest';
import { AgentRouter, ModelTier } from './routing/AgentRouter';
import { ReasoningProfile } from './types/llm';

vi.mock('./registry/AgentRegistry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn(),
  },
}));

vi.mock('./metrics/token-usage', () => ({
  TokenTracker: {
    getRollupRange: vi.fn().mockResolvedValue([]),
  },
}));


describe('AgentRouter', () => {
  describe('selectModel', () => {
    it('respects explicit agent config overrides', async () => {
      const config = {
        id: 'test',
        provider: 'custom-provider',
        model: 'custom-model',
      } as any;
      const result = await AgentRouter.selectModel(config);
      expect(result.provider).toBe('custom-provider');
      expect(result.model).toBe('custom-model');
      expect(result.tier).toBe(ModelTier.BALANCED);
    });

    it('selects economy tier for fast profile', async () => {
      const config = { id: 'test' } as any;
      const result = await AgentRouter.selectModel(config, { profile: ReasoningProfile.FAST });
      expect(result.tier).toBe(ModelTier.ECONOMY);
    });

    it('selects premium tier for deep profile', async () => {
      const config = { id: 'test' } as any;
      const result = await AgentRouter.selectModel(config, { profile: ReasoningProfile.DEEP });
      expect(result.tier).toBe(ModelTier.PREMIUM);
    });

    it('overrides tier based on budget (low)', async () => {
      const config = { id: 'test' } as any;
      const result = await AgentRouter.selectModel(config, { budget: 'low' });
      expect(result.tier).toBe(ModelTier.ECONOMY);
    });

    it('overrides tier based on budget (high)', async () => {
      const config = { id: 'test' } as any;
      const result = await AgentRouter.selectModel(config, { budget: 'high' });
      expect(result.tier).toBe(ModelTier.PREMIUM);
    });

    it('overrides tier based on task complexity (low)', async () => {
      const config = { id: 'test' } as any;
      const result = await AgentRouter.selectModel(config, { taskComplexity: 2 });
      expect(result.tier).toBe(ModelTier.ECONOMY);
    });

    it('overrides tier based on task complexity (high)', async () => {
      const config = { id: 'test' } as any;
      const result = await AgentRouter.selectModel(config, { taskComplexity: 9 });
      expect(result.tier).toBe(ModelTier.PREMIUM);
    });
  });

  describe('computeScore', () => {
    it('computes higher score for better success rate', () => {
      const r1 = {
        totalInvocations: 10,
        successRate: 0.9,
        avgInputTokens: 100,
        avgOutputTokens: 100,
      } as any;
      const r2 = {
        totalInvocations: 10,
        successRate: 0.5,
        avgInputTokens: 100,
        avgOutputTokens: 100,
      } as any;
      expect(AgentRouter.computeScore(r1)).toBeGreaterThan(AgentRouter.computeScore(r2));
    });

    it('penalizes higher token usage', () => {
      const r1 = {
        totalInvocations: 10,
        successRate: 0.9,
        avgInputTokens: 100,
        avgOutputTokens: 100,
      } as any;
      const r2 = {
        totalInvocations: 10,
        successRate: 0.9,
        avgInputTokens: 5000,
        avgOutputTokens: 5000,
      } as any;
      expect(AgentRouter.computeScore(r1)).toBeGreaterThan(AgentRouter.computeScore(r2));
    });
  });

  describe('selectBestAgent', () => {
    it('returns undefined for empty candidates', () => {
      expect(AgentRouter.selectBestAgentSync([])).toBeUndefined();
    });

    it('selects the agent with the highest score', () => {
      const candidates = [
        {
          agentId: 'a1',
          totalInvocations: 10,
          successRate: 0.5,
          avgInputTokens: 100,
          avgOutputTokens: 100,
        },
        {
          agentId: 'a2',
          totalInvocations: 10,
          successRate: 0.9,
          avgInputTokens: 100,
          avgOutputTokens: 100,
        },
      ] as any[];
      expect(AgentRouter.selectBestAgentSync(candidates)).toBe('a2');
    });

    it('respects capability match function', () => {
      const candidates = [
        {
          agentId: 'a1',
          totalInvocations: 10,
          successRate: 0.9,
          avgInputTokens: 100,
          avgOutputTokens: 100,
        },
        {
          agentId: 'a2',
          totalInvocations: 10,
          successRate: 0.9,
          avgInputTokens: 100,
          avgOutputTokens: 100,
        },
      ] as any[];
      const matchFn = (id: string) => (id === 'a2' ? 1.0 : 0.1);
      expect(AgentRouter.selectBestAgentSync(candidates, matchFn)).toBe('a2');
    });
  });

  describe('selectBestAgentWithReputation', () => {
    it('incorporates reputation data', () => {
      const candidates = [
        {
          agentId: 'a1',
          totalInvocations: 10,
          successRate: 0.9,
          avgInputTokens: 100,
          avgOutputTokens: 100,
        },
        {
          agentId: 'a2',
          totalInvocations: 10,
          successRate: 0.9,
          avgInputTokens: 100,
          avgOutputTokens: 100,
        },
      ] as any[];
      const reputations = new Map([
        ['a1', { successRate: 1.0, avgLatencyMs: 100, lastActive: Date.now() }],
        ['a2', { successRate: 0.1, avgLatencyMs: 1000, lastActive: Date.now() - 10000000 }],
      ]) as any;
      expect(AgentRouter.selectBestAgentWithReputation(candidates, reputations)).toBe('a1');
    });

    it('returns undefined for empty candidates', () => {
      expect(AgentRouter.selectBestAgentWithReputation([], new Map())).toBeUndefined();
    });
  });

  describe('async selectBestAgent [Sh1]', () => {
    it('should filter out disabled agents during selection', async () => {
      const { AgentRegistry } = await import('./registry/AgentRegistry');
      const mockResult = (id: string, enabled: boolean) =>
        ({
          id,
          name: id,
          enabled,
        }) as any;

      vi.mocked(AgentRegistry.getAgentConfig).mockImplementation(async (id: string) => {
        if (id === 'disabled-agent') return mockResult('disabled-agent', false);
        return mockResult('enabled-agent', true);
      });

      const best = await AgentRouter.selectBestAgent(['disabled-agent', 'enabled-agent']);
      expect(best).toBe('enabled-agent');
      expect(AgentRegistry.getAgentConfig).toHaveBeenCalledWith('disabled-agent');
    });

    it('should throw Error if no enabled agents remain', async () => {
      const { AgentRegistry } = await import('./registry/AgentRegistry');
      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValue({
        id: 'test',
        enabled: false,
      } as any);

      await expect(AgentRouter.selectBestAgent(['test'])).rejects.toThrow(
        'All target agents are disabled: test'
      );
    });
  });
});
