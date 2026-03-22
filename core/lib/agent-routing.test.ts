import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetRollupRange = vi.fn();

vi.mock('./token-usage', () => ({
  TokenTracker: {
    getRollupRange: (...args: unknown[]) => mockGetRollupRange(...args),
  },
}));

import { AgentRouter } from './agent-routing';

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('AgentRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRollupRange.mockResolvedValue([]);
  });

  describe('getMetrics', () => {
    it('should return default metrics when no rollups exist', async () => {
      const metrics = await AgentRouter.getMetrics('coder');
      expect(metrics.agentId).toBe('coder');
      expect(metrics.successRate).toBe(0.5);
      expect(metrics.avgTokensPerInvocation).toBe(0);
      expect(metrics.capabilityScore).toBe(1.0);
    });

    it('should compute success rate from rollups', async () => {
      mockGetRollupRange.mockResolvedValueOnce([
        {
          invocationCount: 100,
          successCount: 90,
          totalInputTokens: 50000,
          totalOutputTokens: 25000,
        },
        {
          invocationCount: 50,
          successCount: 48,
          totalInputTokens: 25000,
          totalOutputTokens: 12000,
        },
      ]);
      const metrics = await AgentRouter.getMetrics('coder');
      expect(metrics.successRate).toBe(0.92);
    });

    it('should penalize high token usage in composite score', async () => {
      mockGetRollupRange.mockResolvedValueOnce([
        {
          invocationCount: 10,
          successCount: 10,
          totalInputTokens: 100000,
          totalOutputTokens: 50000,
        },
      ]);
      const metrics = await AgentRouter.getMetrics('expensive-agent');
      expect(metrics.compositeScore).toBeLessThan(1.0);
    });
  });

  describe('selectBestAgent', () => {
    it('should return the only candidate', async () => {
      const result = await AgentRouter.selectBestAgent(['coder']);
      expect(result).toBe('coder');
    });

    it('should select agent with highest composite score', async () => {
      mockGetRollupRange
        .mockResolvedValueOnce([
          {
            invocationCount: 100,
            successCount: 95,
            totalInputTokens: 50000,
            totalOutputTokens: 25000,
          },
        ])
        .mockResolvedValueOnce([
          {
            invocationCount: 100,
            successCount: 70,
            totalInputTokens: 50000,
            totalOutputTokens: 25000,
          },
        ]);

      const result = await AgentRouter.selectBestAgent(['agent-a', 'agent-b']);
      expect(result).toBe('agent-a');
    });

    it('should throw when no candidates provided', async () => {
      await expect(AgentRouter.selectBestAgent([])).rejects.toThrow('No candidate agents');
    });
  });
});
