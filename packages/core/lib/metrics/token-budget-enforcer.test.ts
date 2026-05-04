import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBudgetEnforcer, resetTokenBudgetEnforcer } from './token-budget-enforcer';

const mockDocClient = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({ Items: [] }),
}));

vi.mock('../utils/ddb-client', () => ({
  getDocClient: () => mockDocClient,
  getMemoryTableName: () => 'MemoryTable',
}));

describe('TokenBudgetEnforcer', () => {
  let enforcer: TokenBudgetEnforcer;

  beforeEach(() => {
    resetTokenBudgetEnforcer();
    enforcer = new TokenBudgetEnforcer({
      maxSessionCostUsd: 1.0,
      maxAgentCostUsd: 0.5,
      maxSessionTokens: 100_000,
      maxAgentTokens: 50_000,
      costPer1kInputTokens: 0.003,
      costPer1kOutputTokens: 0.012,
    });
  });

  describe('recordUsage', () => {
    it('should allow operations within budget', async () => {
      const result = await enforcer.recordUsage('session1', 1000, 500, 'agent1', 'ws-1');
      expect(result.allowed).toBe(true);
      expect(result.sessionCostUsd).toBeGreaterThan(0);
      expect(result.sessionTokens).toBe(1500);
    });

    it('should deny when session cost exceeds budget', async () => {
      // Record enough usage to exceed $1.00 budget
      // At $0.003/1K input + $0.012/1K output, we need a lot of tokens
      for (let i = 0; i < 100; i++) {
        const result = await enforcer.recordUsage('session1', 10_000, 5_000, 'agent1');
        if (!result.allowed) {
          expect(result.reason).toContain('budget exhausted');
          return;
        }
      }
      // If we get here, the budget should have been exceeded
      const finalCheck = await enforcer.checkBudget('session1');
      expect(finalCheck.allowed).toBe(false);
    });

    it('should track multiple sessions independently', async () => {
      await enforcer.recordUsage('session1', 10_000, 5_000, 'agent1');
      await enforcer.recordUsage('session2', 20_000, 10_000, 'agent2');

      const summary = enforcer.getSummary();
      expect(summary).toHaveLength(2);
      expect(summary[0].sessionId).toBe('session1');
      expect(summary[1].sessionId).toBe('session2');
    });

    it('should calculate cost correctly', async () => {
      const result = await enforcer.recordUsage('session1', 1000, 1000);
      // Cost = (1000/1000 * 0.003) + (1000/1000 * 0.012) = 0.015
      expect(result.sessionCostUsd).toBeCloseTo(0.015, 4);
    });
  });

  describe('checkBudget', () => {
    it('should return current budget status without recording', async () => {
      await enforcer.recordUsage('session1', 1000, 500);
      const status = await enforcer.checkBudget('session1');
      expect(status.allowed).toBe(true);
      expect(status.sessionTokens).toBe(1500);
    });

    it('should return allowed true for unknown sessions', async () => {
      const status = await enforcer.checkBudget('unknown');
      expect(status.allowed).toBe(true);
      expect(status.sessionCostUsd).toBe(0);
    });
  });

  describe('clearSession', () => {
    it('should clear session tracking', async () => {
      await enforcer.recordUsage('session1', 1000, 500);
      expect(enforcer.getSummary()).toHaveLength(1);
      enforcer.clearSession('session1');
      expect(enforcer.getSummary()).toHaveLength(0);
    });
  });

  describe('estimateCost', () => {
    it('should estimate cost from tokens', () => {
      const cost = enforcer.estimateCost(1000, 1000);
      expect(cost).toBeCloseTo(0.015, 4);
    });

    it('should return 0 for 0 tokens', () => {
      const cost = enforcer.estimateCost(0, 0);
      expect(cost).toBe(0);
    });
  });

  describe('Durability & Cold Start', () => {
    it('should recover session from DynamoDB on cold start', async () => {
      mockDocClient.send.mockResolvedValueOnce({
        Items: [
          {
            userId: 'BUDGET#session-cold',
            history: [
              {
                promptTokens: 5000,
                completionTokens: 2000,
                estimatedCostUsd: 0.1,
                timestamp: Date.now(),
              },
            ],
          },
        ],
      });

      // New enforcer instance to simulate cold start
      const coldEnforcer = new TokenBudgetEnforcer();
      const result = await coldEnforcer.recordUsage('session-cold', 1000, 500);

      expect(result.sessionTokens).toBe(7000 + 1500);
      expect(mockDocClient.send).toHaveBeenCalled();
    });

    it('should fail-closed if DynamoDB load fails', async () => {
      mockDocClient.send.mockRejectedValueOnce(new Error('DynamoDB down'));

      const coldEnforcer = new TokenBudgetEnforcer();
      const result = await coldEnforcer.recordUsage('session-down', 1000, 500);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('fail-closed');
    });
  });
});
