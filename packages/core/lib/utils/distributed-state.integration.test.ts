import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DistributedState } from './distributed-state';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Mock the docClient specifically
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('@aws-sdk/lib-dynamodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/lib-dynamodb')>();
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockImplementation(() => ({
        send: mockSend,
      })),
    },
  };
});

describe('DistributedState Integration (Command Structure)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('isCircuitOpen command verification', () => {
    it('should construct GetCommand with correct key and table', async () => {
      mockSend.mockResolvedValue({ Item: { count: 10, openedAt: Date.now() } });

      await DistributedState.isCircuitOpen('test-circuit', 5, 1000);

      expect(mockSend).toHaveBeenCalledWith(expect.any(GetCommand));
      const command = mockSend.mock.calls[0][0] as GetCommand;
      expect(command.input.Key).toEqual({ userId: 'CIRCUIT#test-circuit', timestamp: 0 });
    });
  });

  describe('consumeToken command verification', () => {
    it('should construct UpdateCommand with atomic increment logic', async () => {
      // 1. Get returns an item
      const now = Date.now();
      mockSend.mockResolvedValueOnce({
        Item: {
          tokens: 5,
          lastRefill: now - 1000,
        },
      });
      // 2. Update succeeds
      mockSend.mockResolvedValueOnce({});

      await DistributedState.consumeToken('test-rate', 10, 1000);

      expect(mockSend).toHaveBeenCalledTimes(2);
      const updateCommand = mockSend.mock.calls[1][0] as UpdateCommand;

      expect(updateCommand.input.UpdateExpression).toContain('#tokens = :newTokens');
      expect(updateCommand.input.ConditionExpression).toBe(
        '#tokens = :expectedTokens AND lastRefill = :expectedRefill'
      );
      expect(updateCommand.input.ExpressionAttributeValues?.[':expectedTokens']).toBe(5);
      expect(updateCommand.input.ExpressionAttributeValues?.[':expectedRefill']).toBe(now - 1000);
    });

    it('should retry exactly once on ConditionalCheckFailedException', async () => {
      // 1. Get succeeds
      mockSend.mockResolvedValueOnce({ Item: { tokens: 1, lastRefill: Date.now() } });
      // 2. Update fails with race condition
      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      // 3. Retry: Get succeeds
      mockSend.mockResolvedValueOnce({ Item: { tokens: 1, lastRefill: Date.now() } });
      // 4. Retry: Update succeeds
      mockSend.mockResolvedValueOnce({});

      const result = await DistributedState.consumeToken('test-retry', 10, 1000);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(4); // 2 calls per attempt
    });
  });

  describe('recordFailure logic flow', () => {
    it('should perform single-pass update (increment count and return new state)', async () => {
      // 1. Update (increment) -> Returns count=5
      mockSend.mockResolvedValueOnce({ Attributes: { count: 5 } });
      // 2. Update (set openedAt if count matched threshold)
      mockSend.mockResolvedValueOnce({});

      await DistributedState.recordFailure('test-circuit', 5, 60000);

      // Now only 2 calls: Initial atomic update + conditional openedAt update
      expect(mockSend).toHaveBeenCalledTimes(2);

      const firstUpdate = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(firstUpdate.input.UpdateExpression).toContain(
        '#count = if_not_exists(#count, :zero) + :one'
      );
      expect(firstUpdate.input.ReturnValues).toBe('ALL_NEW');

      const lastUpdate = mockSend.mock.calls[1][0] as UpdateCommand;
      expect(lastUpdate.input.UpdateExpression).toBe('SET openedAt = :now');
      expect(lastUpdate.input.ConditionExpression).toBe('attribute_not_exists(openedAt)');
    });
  });
});
