import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParallelAggregator } from './parallel-aggregator';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

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
  const actual = await vi.importActual<any>('@aws-sdk/lib-dynamodb');
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
    it('should initialize with results_shards array', async () => {
      mockSend.mockResolvedValueOnce({});

      await aggregator.init('user1', 'trace1', 2, 'superclaw');

      expect(mockSend).toHaveBeenCalledWith(expect.any(PutCommand));
      const item = mockSend.mock.calls[0][0].input.Item;
      expect(item.results_shards).toEqual([]);
    });
  });

  describe('sharding', () => {
    it('should spill to shard when size threshold is reached', async () => {
      // 1. Mock getState to return a "large" item (close to 300KB)
      const largeResult = 'x'.repeat(350 * 1024);
      const mockState = {
        userId: 'PARALLEL#u1#t1',
        status: 'pending',
        results: [{ taskId: 't1', result: largeResult }],
        results_ids: ['t1'],
        results_shards: [],
        completedCount: 1,
        taskCount: 2,
      };

      // First call is getState, second is UpdateCommand (main), third is PutCommand (shard), fourth is getState (again for merge)
      mockSend
        .mockResolvedValueOnce({ Item: mockState }) // 1. getState -> GetCommand
        .mockResolvedValueOnce({
          Attributes: { ...mockState, completedCount: 2, results_shards: ['SHARD#1'] },
        }) // 2. UpdateCommand
        .mockResolvedValueOnce({}) // 3. PutCommand (shard)
        .mockResolvedValueOnce({
          Responses: {
            MemoryTable: [{ userId: 'SHARD#1', result: { taskId: 't2', status: 'success' } }],
          },
        }); // 4. mergeShardedResults -> BatchGet

      const result = await aggregator.addResult('u1', 't1', {
        taskId: 't2',
        agentId: 'a2',
        status: 'success',
        durationMs: 100,
        result: 'shard me',
      });

      expect(result?.isComplete).toBe(true);
      // Verify PutCommand was for a shard
      const putCall = mockSend.mock.calls.find((c) =>
        c[0]?.input?.Item?.userId?.includes('PARALLEL_SHARD#')
      );
      expect(putCall).toBeDefined();
      expect(putCall![0].input.Item.userId).toContain('PARALLEL_SHARD#');

      // Verify UpdateCommand added to results_shards
      const updateCall = mockSend.mock.calls.find((c) =>
        c[0]?.input?.UpdateExpression?.includes('results_shards')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0].input.UpdateExpression).toContain('results_shards = list_append');
    });

    it('should merge sharded results in getState', async () => {
      const mainItem = {
        userId: 'PARALLEL#u1#t1',
        results: [{ taskId: 'main', result: 'main-data' }],
        results_shards: ['SHARD#1'],
        results_ids: ['main', 'shard1'],
      };

      mockSend
        .mockResolvedValueOnce({ Item: mainItem }) // Get main item
        .mockResolvedValueOnce({
          Responses: {
            MemoryTable: [
              { userId: 'SHARD#1', result: { taskId: 'shard1', result: 'shard-data' } },
            ],
          },
        }); // BatchGet shards

      const state = await aggregator.getState('u1', 't1');

      expect(state?.results).toHaveLength(2);
      expect(state?.results).toContainEqual(expect.objectContaining({ taskId: 'main' }));
      expect(state?.results).toContainEqual(expect.objectContaining({ taskId: 'shard1' }));
    });
  });
});
