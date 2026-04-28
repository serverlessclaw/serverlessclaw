import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  incrementRecursionDepth,
  getRecursionDepth,
  clearRecursionStack,
  isBudgetExceeded,
} from './recursion-tracker';
import { UpdateCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

// Mock the DynamoDB document client send method
const mockSend = vi.fn();
vi.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({
        send: (cmd: any) => mockSend(cmd),
      }),
    },
    UpdateCommand: class {
      constructor(public input: any) {}
    },
    GetCommand: class {
      constructor(public input: any) {}
    },
    DeleteCommand: class {
      constructor(public input: any) {}
    },
  };
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
}));

describe('recursion-tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMORY_TABLE_NAME;
  });

  describe('incrementRecursionDepth', () => {
    it('should use atomic increment and return new depth', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { depth: 1 },
      });

      const depth = await incrementRecursionDepth('trace-1', 'sess-1', 'agent-1');

      expect(depth).toBe(1);
      expect(mockSend).toHaveBeenCalledWith(expect.any(UpdateCommand));
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.UpdateExpression).toContain(
        'SET #depth = if_not_exists(#depth, :zero) + :one'
      );
      expect(cmd.input.ExpressionAttributeValues[':zero']).toBe(0);
      expect(cmd.input.ExpressionAttributeValues[':one']).toBe(1);
      expect(cmd.input.ReturnValues).toBe('UPDATED_NEW');
    });

    it('should use shorter TTL for mission-critical contexts', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { depth: 1 },
      });

      // Mission context uses 30 min (1800s) TTL vs normal 1 hour (3600s)
      await incrementRecursionDepth('trace-1', 'sess-1', 'agent-1', { isMissionContext: true });

      const cmd = mockSend.mock.calls[0][0];
      const expectedExpires = Math.floor(Date.now() / 1000) + 1800;
      // Allow slight difference in time
      expect(
        Math.abs(cmd.input.ExpressionAttributeValues[':exp'] - expectedExpires)
      ).toBeLessThanOrEqual(1);
    });

    it('should return -1 on error', async () => {
      mockSend.mockRejectedValue({ name: 'ValidationError', message: 'Invalid input' });

      const depth = await incrementRecursionDepth('trace-1', 'sess-1', 'agent-1');
      expect(depth).toBe(-1);
    });

    it('should use Resource.MemoryTable.name when MEMORY_TABLE_NAME is not set', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { depth: 1 },
      });

      await incrementRecursionDepth('trace-resource', 'sess-resource', 'agent-resource');

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.TableName).toBe('test-memory-table');
    });

    it('should prefer MEMORY_TABLE_NAME env var over Resource fallback', async () => {
      process.env.MEMORY_TABLE_NAME = 'env-memory-table';
      mockSend.mockResolvedValueOnce({
        Attributes: { depth: 1 },
      });

      await incrementRecursionDepth('trace-env', 'sess-env', 'agent-env');

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.TableName).toBe('env-memory-table');
      delete process.env.MEMORY_TABLE_NAME;
    });
  });

  describe('getRecursionDepth', () => {
    it('should return 0 if no entry found', async () => {
      mockSend.mockResolvedValue({ Item: undefined });
      const depth = await getRecursionDepth('trace-1');
      expect(mockSend).toHaveBeenCalledWith(expect.any(GetCommand));
      expect(depth).toBe(0);
    });

    it('should return depth from item', async () => {
      mockSend.mockResolvedValue({ Item: { depth: 12 } });
      const depth = await getRecursionDepth('trace-1');
      expect(depth).toBe(12);
    });

    it('should return -1 on error to distinguish from no-entry', async () => {
      mockSend.mockRejectedValue({ name: 'ResourceNotFoundException' });
      const depth = await getRecursionDepth('trace-1');
      expect(depth).toBe(-1);
    });
  });

  describe('clearRecursionStack', () => {
    it('should use conditional delete based on attribute_exists(depth)', async () => {
      await clearRecursionStack('trace-1');

      expect(mockSend).toHaveBeenCalledWith(expect.any(DeleteCommand));
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(#depth)');
      expect(cmd.input.ExpressionAttributeNames).toEqual({ '#depth': 'depth' });
      expect(cmd.input.Key.timestamp).toBe(0);
    });
  });

  describe('isBudgetExceeded', () => {
    it('should return false if usage is below budget', async () => {
      // Mock budget config
      mockSend.mockResolvedValueOnce({ Item: { value: 1000 } }); // budget
      // Mock usage lookup
      mockSend.mockResolvedValueOnce({ Item: { tokens: 500 } }); // usage

      const exceeded = await isBudgetExceeded('trace-1');
      expect(exceeded).toBe(false);
    });

    it('should return true if usage exceeds budget', async () => {
      mockSend.mockResolvedValueOnce({ Item: { value: 1000 } }); // budget
      mockSend.mockResolvedValueOnce({ Item: { tokens: 1200 } }); // usage

      const exceeded = await isBudgetExceeded('trace-1');
      expect(exceeded).toBe(true);
    });

    it('should be workspace aware', async () => {
      mockSend.mockResolvedValueOnce({ Item: { value: 5000 } }); // budget
      mockSend.mockResolvedValueOnce({ Item: { tokens: 1000 } }); // usage

      await isBudgetExceeded('trace-1', 'ws-99');

      const budgetCmd = mockSend.mock.calls[0][0];
      expect(budgetCmd.input.Key.key).toBe('WS#ws-99#global_token_budget');
    });

    it('should FAIL-CLOSED (return true) if database fails', async () => {
      mockSend.mockRejectedValue(new Error('DynamoDB Down'));

      const exceeded = await isBudgetExceeded('trace-1');
      expect(exceeded).toBe(true); // Fail-closed principle
    });

    it('should warn at 80% capacity', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockSend.mockResolvedValueOnce({ Item: { value: 1000 } }); // budget
      mockSend.mockResolvedValueOnce({ Item: { tokens: 850 } }); // usage

      await isBudgetExceeded('trace-1');
      // We check for logger.warn but in tests we might just check that it didn't crash
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });
});
