import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SafetyBase } from './safety-base';
import { SafetyTier } from '../types/agent';
import { getDocClient } from '../utils/ddb-client';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

vi.mock('../utils/ddb-client', () => ({
  getDocClient: vi.fn(),
  getMemoryTableName: vi.fn(() => 'MemoryTable'),
}));

vi.mock('../logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('SafetyBase Concurrency', () => {
  let safetyBase: SafetyBase;
  const mockDocClient = {
    send: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    safetyBase = new SafetyBase();
    (getDocClient as any).mockReturnValue(mockDocClient);
  });

  describe('persistViolation collision protection', () => {
    it('should retry with jitter on ConditionalCheckFailedException', async () => {
      const violation = {
        id: 'v1',
        agentId: 'agent-1',
        safetyTier: SafetyTier.PROD,
        action: 'test',
        reason: 'test',
        outcome: 'blocked' as const,
        timestamp: new Date(),
      };

      // First attempt: collision
      const collisionError = new Error('Collision');
      (collisionError as any).name = 'ConditionalCheckFailedException';

      mockDocClient.send
        .mockRejectedValueOnce(collisionError)
        .mockResolvedValueOnce({ success: true });

      const result = await safetyBase.persistViolation(violation);

      expect(result).toBe(true);
      expect(mockDocClient.send).toHaveBeenCalledTimes(2);

      // Verify jitter: timestamp should be different in the second call
      const firstCallItem = (mockDocClient.send.mock.calls[0][0] as PutCommand).input.Item;
      const secondCallItem = (mockDocClient.send.mock.calls[1][0] as PutCommand).input.Item;

      expect(secondCallItem?.timestamp).toBe((firstCallItem?.timestamp as number) + 1);
      expect((mockDocClient.send.mock.calls[1][0] as PutCommand).input.ConditionExpression).toBe(
        'attribute_not_exists(userId)'
      );
    });

    it('should fail after max retries if collisions persist', async () => {
      const violation = {
        id: 'v1',
        agentId: 'agent-1',
        safetyTier: SafetyTier.PROD,
        action: 'test',
        reason: 'test',
        outcome: 'blocked' as const,
        timestamp: new Date(),
      };

      const collisionError = new Error('Collision');
      (collisionError as any).name = 'ConditionalCheckFailedException';

      mockDocClient.send.mockRejectedValue(collisionError);

      const result = await safetyBase.persistViolation(violation);

      expect(result).toBe(false);
      expect(mockDocClient.send).toHaveBeenCalledTimes(3); // 0, 1, 2 attempts
    });
  });
});
