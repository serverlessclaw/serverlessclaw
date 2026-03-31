import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./metrics/token-usage', () => ({
  TokenTracker: {
    getRollupRange: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { AgentRouter } from './agent-routing';
import { TokenTracker } from './metrics/token-usage';

describe('AgentRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMetrics', () => {
    it('should return default metrics when no rollups exist', async () => {
      (TokenTracker.getRollupRange as any).mockResolvedValueOnce([]);
      const result = await AgentRouter.getMetrics('agent-1');
      expect(result.agentId).toBe('agent-1');
      expect(result.successRate).toBe(0.5);
      expect(result.avgTokensPerInvocation).toBe(0);
      expect(result.capabilityScore).toBe(1.0);
    });

    it('should calculate metrics from rollups', async () => {
      (TokenTracker.getRollupRange as any).mockResolvedValueOnce([
        { invocationCount: 10, successCount: 9, totalInputTokens: 500, totalOutputTokens: 200 },
        { invocationCount: 5, successCount: 5, totalInputTokens: 300, totalOutputTokens: 100 },
      ]);
      const result = await AgentRouter.getMetrics('agent-1');
      expect(result.successRate).toBeCloseTo(0.933, 2);
      expect(result.avgTokensPerInvocation).toBe(73);
    });

    it('should use custom capability score', async () => {
      (TokenTracker.getRollupRange as any).mockResolvedValueOnce([]);
      const result = await AgentRouter.getMetrics('agent-1', 0.8);
      expect(result.capabilityScore).toBe(0.8);
    });

    it('should handle token tracker errors gracefully', async () => {
      (TokenTracker.getRollupRange as any).mockRejectedValueOnce(new Error('DB error'));
      const result = await AgentRouter.getMetrics('agent-1');
      expect(result.successRate).toBe(0.5);
    });

    it('should calculate composite score correctly', async () => {
      (TokenTracker.getRollupRange as any).mockResolvedValueOnce([
        { invocationCount: 10, successCount: 10, totalInputTokens: 1000, totalOutputTokens: 500 },
      ]);
      const result = await AgentRouter.getMetrics('agent-1', 1.0);
      expect(result.compositeScore).toBeGreaterThan(0);
    });
  });

  describe('selectBestAgent', () => {
    it('should throw when no candidates provided', async () => {
      await expect(AgentRouter.selectBestAgent([])).rejects.toThrow('No candidate agents provided');
    });

    it('should return the only candidate when one is provided', async () => {
      const result = await AgentRouter.selectBestAgent(['agent-1']);
      expect(result).toBe('agent-1');
    });

    it('should select agent with highest composite score', async () => {
      (TokenTracker.getRollupRange as any)
        .mockResolvedValueOnce([
          { invocationCount: 10, successCount: 9, totalInputTokens: 100, totalOutputTokens: 50 },
        ])
        .mockResolvedValueOnce([
          { invocationCount: 10, successCount: 5, totalInputTokens: 500, totalOutputTokens: 300 },
        ]);
      const result = await AgentRouter.selectBestAgent(['agent-good', 'agent-bad']);
      expect(result).toBe('agent-good');
    });

    it('should respect capability scores', async () => {
      (TokenTracker.getRollupRange as any).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      const result = await AgentRouter.selectBestAgent(['agent-1', 'agent-2'], {
        'agent-1': 0.5,
        'agent-2': 2.0,
      });
      expect(result).toBe('agent-2');
    });
  });
});
