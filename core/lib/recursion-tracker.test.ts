import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushRecursionEntry, getRecursionDepth, clearRecursionStack } from './recursion-tracker';
import { UpdateCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

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
  });

  describe('pushRecursionEntry', () => {
    it('should use monotonic depth guard in ConditionExpression', async () => {
      await pushRecursionEntry('trace-1', 5, 'sess-1', 'agent-1');

      expect(mockSend).toHaveBeenCalledWith(expect.any(UpdateCommand));
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ConditionExpression).toBe('attribute_not_exists(#depth) OR #depth < :depth');
      expect(cmd.input.ExpressionAttributeNames).toEqual({ '#depth': 'depth', '#type': 'type' });
      expect(cmd.input.ExpressionAttributeValues[':depth']).toBe(5);
      expect(cmd.input.Key.timestamp).toBe(0);
    });

    it('should handle ConditionalCheckFailedException gracefully', async () => {
      mockSend.mockRejectedValue({ name: 'ConditionalCheckFailedException' });

      // Should not throw
      await expect(pushRecursionEntry('trace-1', 3, 'sess-1', 'agent-1')).resolves.not.toThrow();
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
});
