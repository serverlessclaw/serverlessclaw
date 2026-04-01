import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParallelAggregator } from './parallel-aggregator';
import { PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

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

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('ParallelAggregator', () => {
  let aggregator: ParallelAggregator;

  beforeEach(() => {
    aggregator = new ParallelAggregator();
    mockSend.mockReset();
  });

  describe('init', () => {
    it('should write results_ids as an array, not a DynamoDB Set', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.init('user123', 'trace456', 2, 'superclaw', 'session-1');

      expect(mockSend).toHaveBeenCalledWith(expect.any(PutCommand));
      const command = mockSend.mock.calls[0][0] as PutCommand;
      const item = command.input.Item;

      expect(item).toBeDefined();
      expect(Array.isArray(item!.results_ids)).toBe(true);
      expect(item!.results_ids).toEqual([]);
      expect(item!.results_ids).not.toBeInstanceOf(Set);
    });

    it('should write results as an empty array', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.init('user123', 'trace456', 2, 'superclaw', 'session-1');

      const command = mockSend.mock.calls[0][0] as PutCommand;
      const item = command.input.Item;

      expect(Array.isArray(item!.results)).toBe(true);
      expect(item!.results).toEqual([]);
    });

    it('should use a valid schema for HK and SK', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.init('user123', 'trace456', 2, 'superclaw', 'session-1');

      const command = mockSend.mock.calls[0][0] as PutCommand;
      const item = command.input.Item;

      expect(typeof item!.userId).toBe('string');
      expect(item!.userId).toContain('PARALLEL#');
      expect(item!.userId).toContain('user123');
      expect(item!.userId).toContain('trace456');
      expect(typeof item!.timestamp).toBe('number');
      expect(item!.timestamp).toBe(0);
    });

    it('should set initial status to pending', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.init('user1', 'trace1', 3, 'superclaw');

      const command = mockSend.mock.calls[0][0] as PutCommand;
      const item = command.input.Item;
      expect(item!.status).toBe('pending');
      expect(item!.completedCount).toBe(0);
      expect(item!.taskCount).toBe(3);
    });

    it('should include taskMapping when provided', async () => {
      mockSend.mockResolvedValueOnce({});

      const mapping = [{ taskId: 't1', agentId: 'a1' }];
      await aggregator.init('u1', 't1', 1, 'superclaw', undefined, mapping);

      const command = mockSend.mock.calls[0][0] as PutCommand;
      expect(command.input.Item!.taskMapping).toEqual(mapping);
    });

    it('should default taskMapping to empty array', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.init('u1', 't1', 1, 'superclaw');

      const command = mockSend.mock.calls[0][0] as PutCommand;
      expect(command.input.Item!.taskMapping).toEqual([]);
    });

    it('should include aggregationType and aggregationPrompt', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.init(
        'u1',
        't1',
        1,
        'superclaw',
        undefined,
        undefined,
        'merge_patches',
        'combine results'
      );

      const command = mockSend.mock.calls[0][0] as PutCommand;
      expect(command.input.Item!.aggregationType).toBe('merge_patches');
      expect(command.input.Item!.aggregationPrompt).toBe('combine results');
    });

    it('should include metadata when provided', async () => {
      mockSend.mockResolvedValueOnce({});

      const meta = { key: 'value' };
      await aggregator.init(
        'u1',
        't1',
        1,
        'superclaw',
        undefined,
        undefined,
        undefined,
        undefined,
        meta
      );

      const command = mockSend.mock.calls[0][0] as PutCommand;
      expect(command.input.Item!.metadata).toEqual(meta);
    });

    it('should default metadata to empty object', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.init('u1', 't1', 1, 'superclaw');

      const command = mockSend.mock.calls[0][0] as PutCommand;
      expect(command.input.Item!.metadata).toEqual({});
    });

    it('should set expiresAt to one hour from now', async () => {
      mockSend.mockResolvedValueOnce({});
      const now = Math.floor(Date.now() / 1000);

      await aggregator.init('u1', 't1', 1, 'superclaw');

      const command = mockSend.mock.calls[0][0] as PutCommand;
      const expiresAt = command.input.Item!.expiresAt as number;
      expect(expiresAt).toBeGreaterThanOrEqual(now + 3599);
      expect(expiresAt).toBeLessThanOrEqual(now + 3601);
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
      expect(command.input.ConditionExpression).toContain('#status = :pending');
      expect(command.input.ConditionExpression).toContain('NOT contains(results_ids, :taskId)');
      expect(command.input.ExpressionAttributeValues?.[':taskId']).toBe('taskA');
    });

    it('should return isComplete true when completedCount >= taskCount', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          completedCount: 2,
          taskCount: 2,
          results: [{ taskId: 't1' }, { taskId: 't2' }],
          status: 'pending',
          initiatorId: 'init1',
          sessionId: 'sess1',
          aggregationType: 'summary',
          aggregationPrompt: 'summarize',
        },
      });

      const result = await aggregator.addResult('u1', 'tr1', {
        taskId: 't2',
        agentId: 'a1',
        status: 'success',
        result: 'done',
        durationMs: 50,
      });

      expect(result).not.toBeNull();
      expect(result!.isComplete).toBe(true);
      expect(result!.taskCount).toBe(2);
      expect(result!.initiatorId).toBe('init1');
      expect(result!.sessionId).toBe('sess1');
      expect(result!.aggregationType).toBe('summary');
      expect(result!.aggregationPrompt).toBe('summarize');
    });

    it('should return isComplete false when not all tasks done', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          completedCount: 1,
          taskCount: 3,
          results: [{ taskId: 't1' }],
          status: 'pending',
          initiatorId: 'init1',
        },
      });

      const result = await aggregator.addResult('u1', 'tr1', {
        taskId: 't1',
        agentId: 'a1',
        status: 'success',
        durationMs: 50,
      });

      expect(result).not.toBeNull();
      expect(result!.isComplete).toBe(false);
    });

    it('should return null when Attributes is missing', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await aggregator.addResult('u1', 'tr1', {
        taskId: 't1',
        agentId: 'a1',
        status: 'success',
        durationMs: 50,
      });

      expect(result).toBeNull();
    });

    it('should return null on ConditionalCheckFailedException', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      const result = await aggregator.addResult('u1', 'tr1', {
        taskId: 't1',
        agentId: 'a1',
        status: 'success',
        durationMs: 50,
      });

      expect(result).toBeNull();
    });

    it('should throw on non-conditional errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB down'));

      await expect(
        aggregator.addResult('u1', 'tr1', {
          taskId: 't1',
          agentId: 'a1',
          status: 'success',
          durationMs: 50,
        })
      ).rejects.toThrow('DynamoDB down');
    });

    it('should use correct composite key for update', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          completedCount: 1,
          taskCount: 1,
          results: [],
          status: 'pending',
          initiatorId: 'i',
        },
      });

      await aggregator.addResult('user1', 'trace1', {
        taskId: 't1',
        agentId: 'a1',
        status: 'success',
        durationMs: 10,
      });

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(command.input.Key).toEqual({
        userId: 'PARALLEL#user1#trace1',
        timestamp: 0,
      });
    });

    it('should return results array from response', async () => {
      const results = [{ taskId: 't1', status: 'success' }];
      mockSend.mockResolvedValueOnce({
        Attributes: {
          completedCount: 1,
          taskCount: 1,
          results,
          status: 'pending',
          initiatorId: 'i',
        },
      });

      const result = await aggregator.addResult('u1', 'tr1', {
        taskId: 't1',
        agentId: 'a1',
        status: 'success',
        durationMs: 10,
      });

      expect(result!.results).toEqual(results);
    });
  });

  describe('markAsCompleted', () => {
    it('should return true when marking a pending dispatch as completed', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await aggregator.markAsCompleted('user123', 'trace456', 'success');

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(UpdateCommand));
      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(command.input.ConditionExpression).toContain('#status = :pending');
    });

    it('should return false if already completed (ConditionalCheckFailed)', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      const result = await aggregator.markAsCompleted('user123', 'trace456', 'success');

      expect(result).toBe(false);
    });

    it('should throw on non-conditional errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB down'));

      await expect(aggregator.markAsCompleted('u1', 't1', 'success')).rejects.toThrow(
        'DynamoDB down'
      );
    });

    it('should set status and completedAt in update', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.markAsCompleted('u1', 't1', 'partial');

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(command.input.ExpressionAttributeValues?.[':status']).toBe('partial');
      expect(command.input.UpdateExpression).toContain('completedAt = :now');
    });

    it('should handle all status types', async () => {
      const statuses = ['success', 'partial', 'failed', 'timeout'] as const;

      for (const status of statuses) {
        mockSend.mockResolvedValueOnce({});
        const result = await aggregator.markAsCompleted('u1', 't1', status);
        expect(result).toBe(true);
      }
    });

    it('should use correct composite key', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.markAsCompleted('user1', 'trace1', 'success');

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(command.input.Key).toEqual({
        userId: 'PARALLEL#user1#trace1',
        timestamp: 0,
      });
    });
  });

  describe('getState', () => {
    it('should return the item from DynamoDB', async () => {
      const item = {
        userId: 'PARALLEL#u1#t1',
        timestamp: 0,
        taskCount: 3,
        completedCount: 1,
        results: [],
        initiatorId: 'i1',
        status: 'pending',
      };
      mockSend.mockResolvedValueOnce({ Item: item });

      const result = await aggregator.getState('u1', 't1');

      expect(result).toEqual(item);
      expect(mockSend).toHaveBeenCalledWith(expect.any(GetCommand));
    });

    it('should return undefined when item not found', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await aggregator.getState('u1', 't1');

      expect(result).toBeUndefined();
    });

    it('should use correct composite key', async () => {
      mockSend.mockResolvedValueOnce({ Item: {} });

      await aggregator.getState('user1', 'trace1');

      const command = mockSend.mock.calls[0][0] as GetCommand;
      expect(command.input.Key).toEqual({
        userId: 'PARALLEL#user1#trace1',
        timestamp: 0,
      });
    });
  });

  describe('updateDagState', () => {
    it('should return true on successful update', async () => {
      mockSend.mockResolvedValueOnce({});

      const dagState = {
        nodes: {},
        readyQueue: [],
        completedTasks: [],
        failedTasks: [],
        outputs: {},
      };

      const result = await aggregator.updateDagState('u1', 't1', dagState, 1);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(expect.any(UpdateCommand));
    });

    it('should return false on ConditionalCheckFailedException', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      const dagState = {
        nodes: {},
        readyQueue: [],
        completedTasks: [],
        failedTasks: [],
        outputs: {},
      };
      const result = await aggregator.updateDagState('u1', 't1', dagState, 1);

      expect(result).toBe(false);
    });

    it('should throw on non-conditional errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB down'));

      const dagState = {
        nodes: {},
        readyQueue: [],
        completedTasks: [],
        failedTasks: [],
        outputs: {},
      };
      await expect(aggregator.updateDagState('u1', 't1', dagState, 1)).rejects.toThrow(
        'DynamoDB down'
      );
    });

    it('should increment version for optimistic concurrency', async () => {
      mockSend.mockResolvedValueOnce({});

      const dagState = {
        nodes: {},
        readyQueue: [],
        completedTasks: [],
        failedTasks: [],
        outputs: {},
      };
      await aggregator.updateDagState('u1', 't1', dagState, 5);

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(command.input.ExpressionAttributeValues?.[':expectedVersion']).toBe(5);
      expect(command.input.ExpressionAttributeValues?.[':nextVersion']).toBe(6);
    });

    it('should check version in condition expression', async () => {
      mockSend.mockResolvedValueOnce({});

      const dagState = {
        nodes: {},
        readyQueue: [],
        completedTasks: [],
        failedTasks: [],
        outputs: {},
      };
      await aggregator.updateDagState('u1', 't1', dagState, 1);

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(command.input.ConditionExpression).toContain('version = :expectedVersion');
    });
  });

  describe('updateProgress', () => {
    it('should update task progress without throwing', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.updateProgress('u1', 't1', 'task1', 50);

      expect(mockSend).toHaveBeenCalledWith(expect.any(UpdateCommand));
    });

    it('should use correct composite key', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.updateProgress('u1', 't1', 'task1', 50);

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      expect(command.input.Key).toEqual({
        userId: 'PARALLEL#u1#t1',
        timestamp: 0,
      });
    });

    it('should set progress with status and percent', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.updateProgress('u1', 't1', 'task1', 75, 'completed');

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      const progress = command.input.ExpressionAttributeValues?.[':progress'];
      expect(progress.status).toBe('completed');
      expect(progress.progressPercent).toBe(75);
    });

    it('should default status to in_progress', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.updateProgress('u1', 't1', 'task1', 30);

      const command = mockSend.mock.calls[0][0] as UpdateCommand;
      const progress = command.input.ExpressionAttributeValues?.[':progress'];
      expect(progress.status).toBe('in_progress');
    });

    it('should handle errors gracefully without throwing', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB down'));

      await expect(aggregator.updateProgress('u1', 't1', 'task1', 50)).resolves.not.toThrow();
    });
  });
});
