import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParallelAggregator } from './parallel-aggregator';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'MemoryTable' },
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: class {
      send = mockSend;
    },
  };
});

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: () => ({
        send: (command: any) => mockSend(command),
      }),
    },
  };
});

describe('ParallelAggregator', () => {
  let aggregator: ParallelAggregator;

  beforeEach(() => {
    aggregator = new ParallelAggregator();
    mockSend.mockReset();
  });

  describe('markAsCompleted', () => {
    it('should return true when marking a pending dispatch as completed', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await aggregator.markAsCompleted('user123', 'trace456', 'success');

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(UpdateCommand));
      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(command.input.ConditionExpression).toContain('status = :pending');
      expect(command.input.ExpressionAttributeValues?.[':status']).toBe('success');
    });

    it('should return false if already completed (ConditionalCheckFailed)', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      const result = await aggregator.markAsCompleted('user123', 'trace456', 'success');

      expect(result).toBe(false);
    });
  });

  describe('addResult', () => {
    it('should include taskId in results_ids set to prevent duplicates', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          completedCount: 1,
          taskCount: 2,
          results: [],
          status: 'pending',
          initiatorId: 'test',
        },
      });

      await aggregator.addResult('user123', 'trace456', {
        taskId: 'taskA',
        agentId: 'agentA',
        status: 'success',
        result: 'ok',
        durationMs: 100,
      });

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(command.input.UpdateExpression).toContain('results_ids = list_append');
      expect(command.input.ConditionExpression).toContain('NOT contains(results_ids, :taskId)');
      expect(command.input.ExpressionAttributeValues?.[':taskId']).toBe('taskA');
    });
  });
});
