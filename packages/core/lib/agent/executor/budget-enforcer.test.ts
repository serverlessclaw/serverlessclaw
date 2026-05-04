import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BudgetEnforcer } from './budget-enforcer';
import { ExecutorUsage } from '../executor-types';
import { logger } from '../../logger';
import { estimateCost } from '../../providers/pricing';

// Mock logger
vi.mock('../../logger', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock pricing
vi.mock('../../providers/pricing', () => ({
  estimateCost: vi.fn().mockReturnValue(0.05),
}));

describe('BudgetEnforcer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(estimateCost).mockReturnValue(0.05);
  });

  describe('check', () => {
    const agentId = 'test-agent';
    const defaultOptions: any = {
      activeProvider: 'openai',
      activeModel: 'gpt-4',
    };

    it('should return null if no budgets are set', () => {
      const result = BudgetEnforcer.check(agentId, defaultOptions);
      expect(result).toBeNull();
    });

    it('should return null if usage is within budget', () => {
      const options = { ...defaultOptions, tokenBudget: 1000 };
      const usage: ExecutorUsage = {
        total_tokens: 500,
        totalInputTokens: 300,
        totalOutputTokens: 200,
        toolCallCount: 0,
        durationMs: 0,
      };

      const result = BudgetEnforcer.check(agentId, options, usage);
      expect(result).toBeNull();
    });

    it('should return exceeded result if token budget is exceeded', () => {
      const options = { ...defaultOptions, tokenBudget: 1000 };
      const usage: ExecutorUsage = {
        total_tokens: 1500,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        toolCallCount: 0,
        durationMs: 0,
      };

      const result = BudgetEnforcer.check(agentId, options, usage);
      expect(result).not.toBeNull();
      expect(result?.responseText).toContain('[BUDGET_EXCEEDED]');
      expect(result?.isWarning).toBeFalsy();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Token budget exceeded'));
    });

    it('should return warning result if token budget threshold (80%) is reached', () => {
      const options = { ...defaultOptions, tokenBudget: 1000 };
      const usage: ExecutorUsage = {
        total_tokens: 850,
        totalInputTokens: 500,
        totalOutputTokens: 350,
        toolCallCount: 0,
        durationMs: 0,
      };

      const result = BudgetEnforcer.check(agentId, options, usage);
      expect(result).not.toBeNull();
      expect(result?.responseText).toContain('[BUDGET_WARNING]');
      expect(result?.isWarning).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Token budget at 85%'));
    });

    it('should return exceeded result if cost limit is exceeded', () => {
      const options = { ...defaultOptions, costLimit: 0.01 };
      const usage: ExecutorUsage = {
        total_tokens: 1000,
        totalInputTokens: 500,
        totalOutputTokens: 500,
        toolCallCount: 0,
        durationMs: 0,
      };

      // Mock estimateCost to return more than the limit
      vi.mocked(estimateCost).mockReturnValue(0.02);

      const result = BudgetEnforcer.check(agentId, options, usage);
      expect(result).not.toBeNull();
      expect(result?.responseText).toContain('[COST_LIMIT_EXCEEDED]');
      expect(result?.isWarning).toBeFalsy();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Cost limit exceeded'));
    });

    it('should return warning result if cost limit threshold (80%) is reached', () => {
      const options = { ...defaultOptions, costLimit: 0.1 };
      const usage: ExecutorUsage = {
        total_tokens: 1000,
        totalInputTokens: 500,
        totalOutputTokens: 500,
        toolCallCount: 0,
        durationMs: 0,
      };

      // Mock estimateCost to return 90% of the limit
      vi.mocked(estimateCost).mockReturnValue(0.09);

      const result = BudgetEnforcer.check(agentId, options, usage);
      expect(result).not.toBeNull();
      expect(result?.responseText).toContain('[COST_WARNING]');
      expect(result?.isWarning).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Cost at 90%'));
    });
  });

  describe('estimateCost', () => {
    it('should call calcCost with usage tokens', () => {
      const usage: ExecutorUsage = {
        total_tokens: 1000,
        totalInputTokens: 600,
        totalOutputTokens: 400,
        toolCallCount: 0,
        durationMs: 0,
      };

      BudgetEnforcer.estimateCost(usage, 'provider', 'model');
      expect(estimateCost).toHaveBeenCalledWith(600, 400, 'provider', 'model');
    });
  });
});
