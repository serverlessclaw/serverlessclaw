import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  GetCommand: class {
    constructor(public input: any) {}
  },
  UpdateCommand: class {
    constructor(public input: any) {}
  },
}));

import { getDeployCountToday, incrementDeployCount, rewardDeployLimit } from './deploy-stats';

describe('deploy-stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDeployCountToday', () => {
    it('should return 0 when no record exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: null });
      const result = await getDeployCountToday();
      expect(result).toBe(0);
    });

    it('should return count when lastReset matches today', async () => {
      const today = new Date().toISOString().split('T')[0];
      mockSend.mockResolvedValueOnce({ Item: { lastReset: today, count: 3 } });
      const result = await getDeployCountToday();
      expect(result).toBe(3);
    });

    it('should return 0 when lastReset is a different day', async () => {
      mockSend.mockResolvedValueOnce({ Item: { lastReset: '2020-01-01', count: 5 } });
      const result = await getDeployCountToday();
      expect(result).toBe(0);
    });

    it('should return 0 when count is undefined', async () => {
      const today = new Date().toISOString().split('T')[0];
      mockSend.mockResolvedValueOnce({ Item: { lastReset: today } });
      const result = await getDeployCountToday();
      expect(result).toBe(0);
    });
  });

  describe('incrementDeployCount', () => {
    it('should return true when same-day increment succeeds', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await incrementDeployCount('2026-03-26', 5);
      expect(result).toBe(true);
    });

    it('should reset counter and return true on a new UTC day', async () => {
      // Step 1 (same-day CCE): lastReset differs from today
      const cce = new Error('Conditional check failed');
      cce.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(cce);
      // Step 2 (new-day reset): succeeds
      mockSend.mockResolvedValueOnce({});

      const result = await incrementDeployCount('2026-03-27', 5);
      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should return false when today limit is reached', async () => {
      // Step 1 CCE (limit reached today — lastReset = today, count >= limit)
      const cce = new Error('Conditional check failed');
      cce.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(cce);
      // Step 2 CCE (lastReset = today → confirmed today, not a new day)
      const cce2 = new Error('Conditional check failed');
      cce2.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(cce2);
      // Step 3 CCE (retry same-day increment also blocked)
      const cce3 = new Error('Conditional check failed');
      cce3.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(cce3);

      const result = await incrementDeployCount('2026-03-26', 5);
      expect(result).toBe(false);
    });

    it('should throw on unexpected errors in step 1', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));
      await expect(incrementDeployCount('2026-03-26', 5)).rejects.toThrow('Network error');
    });

    it('should throw on unexpected errors in step 2', async () => {
      const cce = new Error('Conditional check failed');
      cce.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(cce);
      mockSend.mockRejectedValueOnce(new Error('DynamoDB throttle'));
      await expect(incrementDeployCount('2026-03-26', 5)).rejects.toThrow('DynamoDB throttle');
    });
  });

  describe('rewardDeployLimit', () => {
    it('should succeed when count > 0', async () => {
      mockSend.mockResolvedValueOnce({});
      await expect(rewardDeployLimit()).resolves.not.toThrow();
    });

    it('should not throw when count is already 0', async () => {
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);
      await expect(rewardDeployLimit()).resolves.not.toThrow();
    });

    it('should throw on unexpected errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));
      await expect(rewardDeployLimit()).rejects.toThrow('Network error');
    });
  });
});
