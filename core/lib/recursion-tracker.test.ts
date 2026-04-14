import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  incrementRecursionDepth,
  getRecursionDepth,
  clearRecursionStack,
} from './recursion-tracker';
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
      await incrementRecursionDepth('trace-1', 'sess-1', 'agent-1', true);

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
});
