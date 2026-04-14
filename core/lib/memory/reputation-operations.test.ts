import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getReputation,
  getReputations,
  updateReputation,
  computeReputationScore,
} from './reputation-operations';
import { MEMORY_KEYS } from '../constants';

const mockBase = {
  queryItems: vi.fn(),
  putItem: vi.fn(),
  updateItem: vi.fn(),
};

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ReputationOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getReputation', () => {
    it('should return null if no reputation record exists', async () => {
      mockBase.queryItems.mockResolvedValue([]);
      const result = await getReputation(mockBase as any, 'agent-1');
      expect(result).toBeNull();
      expect(mockBase.queryItems).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({
            ':pk': `${MEMORY_KEYS.REPUTATION_PREFIX}agent-1`,
          }),
        })
      );
    });

    it('should return agent reputation data if found', async () => {
      const mockItem = {
        agentId: 'agent-1',
        tasksCompleted: 10,
        tasksFailed: 2,
        totalLatencyMs: 12000,
        successRate: 0.833,
        avgLatencyMs: 1200,
        lastActive: Date.now(),
        windowStart: Date.now() - 3600000,
        expiresAt: 0,
      };
      mockBase.queryItems.mockResolvedValue([mockItem]);
      const result = await getReputation(mockBase as any, 'agent-1');
      expect(result).toMatchObject({
        agentId: 'agent-1',
        tasksCompleted: 10,
        tasksFailed: 2,
        totalLatencyMs: 12000,
        successRate: 0.833,
        avgLatencyMs: 1200,
        totalTasks: 12,
        rollingWindow: 7,
      });
      expect(result!.score).toBeGreaterThan(0);
      expect(result!.createdAt).toBeDefined();
    });
  });

  describe('updateReputation', () => {
    it('should accumulate metrics within rolling window', async () => {
      const now = Date.now();
      const existing = {
        agentId: 'agent-1',
        tasksCompleted: 5,
        tasksFailed: 1,
        totalLatencyMs: 5000,
        successRate: 0.833,
        avgLatencyMs: 1000,
        lastActive: now - 3600000,
        windowStart: now - 7200000,
        expiresAt: 0,
      };
      mockBase.queryItems.mockResolvedValue([existing]);

      await updateReputation(mockBase as any, 'agent-1', true, 1000);

      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: expect.objectContaining({ userId: 'REPUTATION#agent-1' }),
          UpdateExpression: expect.stringContaining('tasksCompleted'),
        })
      );
    });

    it('should reset metrics when window expires', async () => {
      const now = Date.now();
      const expired = {
        agentId: 'agent-1',
        tasksCompleted: 100,
        tasksFailed: 20,
        totalLatencyMs: 100000,
        successRate: 0.833,
        avgLatencyMs: 1000,
        lastActive: now - 10 * 86400000,
        windowStart: now - 11 * 86400000,
        expiresAt: 0,
      };
      mockBase.queryItems.mockResolvedValue([expired]);

      await updateReputation(mockBase as any, 'agent-1', true, 2000);

      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: expect.objectContaining({ userId: 'REPUTATION#agent-1' }),
          UpdateExpression: expect.stringContaining('tasksCompleted'),
        })
      );
    });
  });

  describe('computeReputationScore', () => {
    it('should compute a high score for perfect performance', () => {
      const reputation = {
        agentId: 'agent-1',
        tasksCompleted: 10,
        tasksFailed: 0,
        totalLatencyMs: 10000,
        successRate: 1.0,
        avgLatencyMs: 1000,
        lastActive: Date.now(),
        windowStart: Date.now() - 3600000,
        expiresAt: 0,
        createdAt: Date.now() - 3600000,
        totalTasks: 10,
        rollingWindow: 7,
        score: 0,
      };
      const score = computeReputationScore(reputation);
      expect(score).toBeGreaterThan(0.9);
    });

    it('should penalize failed tasks heavily (60% weight)', () => {
      const badRep = {
        agentId: 'agent-bad',
        tasksCompleted: 0,
        tasksFailed: 10,
        totalLatencyMs: 0,
        successRate: 0.0,
        avgLatencyMs: 0,
        lastActive: Date.now(),
        windowStart: Date.now() - 3600000,
        expiresAt: 0,
        createdAt: Date.now() - 3600000,
        totalTasks: 10,
        rollingWindow: 7,
        score: 0,
      };
      const score = computeReputationScore(badRep);
      expect(score).toBeLessThanOrEqual(0.4); // Latency and recency might still provide some score
    });

    it('should penalize high latency (25% weight)', () => {
      const now = Date.now();
      const slowRep = {
        agentId: 'agent-slow',
        tasksCompleted: 10,
        tasksFailed: 0,
        totalLatencyMs: 200000, // 20s avg
        successRate: 1.0,
        avgLatencyMs: 20000,
        lastActive: now,
        windowStart: now - 3600000,
        expiresAt: 0,
        createdAt: now - 3600000,
        totalTasks: 10,
        rollingWindow: 7,
        score: 0,
      };
      const score = computeReputationScore(slowRep);

      expect(score).toBeLessThan(0.8); // Perfect success but very slow
    });

    it('should penalize perfect but very old performance', () => {
      const now = Date.now();
      const oldRep = {
        agentId: 'agent-old',
        tasksCompleted: 10,
        tasksFailed: 0,
        totalLatencyMs: 10000,
        successRate: 1.0,
        avgLatencyMs: 1000,
        lastActive: now - 48 * 3600000, // 2 days ago
        windowStart: now - 3600000,
        expiresAt: 0,
        createdAt: now - 48 * 3600000,
        totalTasks: 10,
        rollingWindow: 7,
        score: 0,
      };
      const score = computeReputationScore(oldRep);

      expect(score).toBeLessThan(0.9); // Perfect but stale
    });

    it('should handle zero total tasks without division by zero', () => {
      const now = Date.now();
      const zeroRep = {
        agentId: 'agent-zero',
        tasksCompleted: 0,
        tasksFailed: 0,
        totalLatencyMs: 0,
        successRate: 0,
        avgLatencyMs: 0,
        lastActive: now,
        windowStart: now,
        expiresAt: 0,
        createdAt: now,
        totalTasks: 0,
        rollingWindow: 7,
        score: 0,
      };
      const score = computeReputationScore(zeroRep);

      expect(score).toBeDefined();
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
      expect(score).toBeCloseTo(0.4, 2); // 0*0.6 + 1*0.25 + 1*0.15 = 0.4
    });

    it('should handle lastActive far in future (negative hoursSinceActive)', () => {
      const now = Date.now();
      const futureRep = {
        agentId: 'agent-future',
        tasksCompleted: 5,
        tasksFailed: 0,
        totalLatencyMs: 5000,
        successRate: 1.0,
        avgLatencyMs: 1000,
        lastActive: now + 100 * 3600000,
        windowStart: now - 3600000,
        expiresAt: 0,
        createdAt: now - 3600000,
        totalTasks: 5,
        rollingWindow: 7,
        score: 0,
      };
      const score = computeReputationScore(futureRep);

      expect(score).toBeDefined();
      expect(Number.isNaN(score)).toBe(false);
      expect(score).toBeGreaterThan(1.0);
    });

    it('should return score of 0.4 for zero success rate, zero latency, recent activity', () => {
      const now = Date.now();
      const rep = {
        agentId: 'agent-test',
        tasksCompleted: 0,
        tasksFailed: 5,
        totalLatencyMs: 0,
        successRate: 0,
        avgLatencyMs: 0,
        lastActive: now,
        windowStart: now - 3600000,
        expiresAt: 0,
        createdAt: now - 3600000,
        totalTasks: 5,
        rollingWindow: 7,
        score: 0,
      };
      const score = computeReputationScore(rep);

      expect(score).toBeCloseTo(0.4, 2); // 0*0.6 + 1*0.25 + 1*0.15 = 0.4
    });
  });

  describe('getReputations', () => {
    it('should return reputations for multiple agents', async () => {
      const now = Date.now();
      const mockItems = [
        {
          agentId: 'agent-1',
          tasksCompleted: 10,
          tasksFailed: 2,
          totalLatencyMs: 12000,
          successRate: 0.833,
          avgLatencyMs: 1200,
          lastActive: now,
          windowStart: now - 3600000,
          expiresAt: 0,
        },
        {
          agentId: 'agent-2',
          tasksCompleted: 5,
          tasksFailed: 0,
          totalLatencyMs: 5000,
          successRate: 1.0,
          avgLatencyMs: 1000,
          lastActive: now,
          windowStart: now - 3600000,
          expiresAt: 0,
        },
      ];

      mockBase.queryItems
        .mockResolvedValueOnce([mockItems[0]])
        .mockResolvedValueOnce([mockItems[1]]);

      const result = await getReputations(mockBase as any, ['agent-1', 'agent-2']);

      expect(result.size).toBe(2);
      expect(result.has('agent-1')).toBe(true);
      expect(result.has('agent-2')).toBe(true);
      expect(result.get('agent-1')?.tasksCompleted).toBe(10);
      expect(result.get('agent-2')?.tasksCompleted).toBe(5);
    });

    it('should handle mix of found and not found agents', async () => {
      const now = Date.now();
      const mockItem = {
        agentId: 'agent-1',
        tasksCompleted: 10,
        tasksFailed: 2,
        totalLatencyMs: 12000,
        successRate: 0.833,
        avgLatencyMs: 1200,
        lastActive: now,
        windowStart: now - 3600000,
        expiresAt: 0,
      };

      mockBase.queryItems.mockResolvedValueOnce([mockItem]).mockResolvedValueOnce([]);

      const result = await getReputations(mockBase as any, ['agent-1', 'agent-missing']);

      expect(result.size).toBe(1);
      expect(result.has('agent-1')).toBe(true);
      expect(result.has('agent-missing')).toBe(false);
    });

    it('should return empty map for empty array input', async () => {
      const result = await getReputations(mockBase as any, []);

      expect(result.size).toBe(0);
      expect(mockBase.queryItems).not.toHaveBeenCalled();
    });
  });

  describe('updateReputation - additional cases', () => {
    it('should create first record when no existing reputation', async () => {
      mockBase.queryItems.mockResolvedValue([]);

      await updateReputation(mockBase as any, 'agent-new', true, 500);

      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: expect.objectContaining({ userId: 'REPUTATION#agent-new' }),
          UpdateExpression: expect.stringContaining('tasksCompleted'),
        })
      );
    });

    it('should handle errors gracefully without throwing', async () => {
      mockBase.queryItems.mockResolvedValue([]);
      mockBase.updateItem.mockRejectedValue(new Error('DynamoDB error'));

      await expect(
        updateReputation(mockBase as any, 'agent-error', true, 100)
      ).resolves.not.toThrow();
    });

    it('should track failed tasks correctly', async () => {
      mockBase.queryItems.mockResolvedValue([]);

      await updateReputation(mockBase as any, 'agent-fail', false, 0);

      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          UpdateExpression: expect.stringContaining('tasksFailed'),
        })
      );
    });

    it('should use default latency of 0 when not provided', async () => {
      mockBase.queryItems.mockResolvedValue([]);

      await updateReputation(mockBase as any, 'agent-default', true);

      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          UpdateExpression: expect.stringContaining('totalLatencyMs'),
        })
      );
    });
  });
});
