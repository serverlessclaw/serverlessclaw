import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParallelAggregator } from './parallel-aggregator';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

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

  describe('getRawState', () => {
    it('should retrieve only the main item', async () => {
      const mockItem = { userId: 'PARALLEL#u1#t1', status: 'pending' };
      mockSend.mockResolvedValueOnce({ Item: mockItem });

      const state = await aggregator.getRawState('u1', 't1');

      expect(mockSend).toHaveBeenCalledWith(expect.any(GetCommand));
      expect(state).toEqual(mockItem);
    });
  });

  describe('sharding', () => {
    it('should spill to shard when main item size threshold is reached', async () => {
      // 1. Mock getRawState to return a "large" main item (close to 300KB)
      const largeResult = 'x'.repeat(305 * 1024);
      const mockMainItem = {
        userId: 'PARALLEL#u1#t1',
        status: 'pending',
        results: [{ taskId: 't1', result: largeResult }],
        results_ids: ['t1'],
        results_shards: [],
        completedCount: 1,
        taskCount: 2,
      };

      // Execution order in addResult (shard flow):
      // 1. getRawState -> GetCommand
      // 2. PutCommand (shard)
      // 3. UpdateCommand (main)
      // 4. mergeShardedResults -> BatchGet
      mockSend
        .mockResolvedValueOnce({ Item: mockMainItem }) // 1. getRawState
        .mockResolvedValueOnce({}) // 2. PutCommand (shard)
        .mockResolvedValueOnce({
          Attributes: { ...mockMainItem, completedCount: 2, results_shards: ['SHARD#2'] },
        }) // 3. UpdateCommand
        .mockResolvedValueOnce({
          Responses: {
            MemoryTable: [{ userId: 'SHARD#2', result: { taskId: 't2', status: 'success' } }],
          },
        }); // 4. mergeShardedResults

      await aggregator.addResult('u1', 't1', {
        taskId: 't2',
        agentId: 'a2',
        status: 'success',
        durationMs: 100,
        result: 'shard me',
      });

      // Verify PutCommand (shard) was called BEFORE UpdateCommand (main)
      const putCallIndex = mockSend.mock.calls.findIndex(
        (c) =>
          c[0]?.constructor?.name === 'PutCommand' &&
          c[0].input.Item.userId.includes('PARALLEL_SHARD#')
      );
      const updateCallIndex = mockSend.mock.calls.findIndex(
        (c) =>
          c[0]?.constructor?.name === 'UpdateCommand' &&
          c[0].input.UpdateExpression.includes('results_shards')
      );

      expect(putCallIndex).toBeGreaterThan(-1);
      expect(updateCallIndex).toBeGreaterThan(-1);
      expect(putCallIndex).toBeLessThan(updateCallIndex);

      // Verify deterministic shard key
      const putCall = mockSend.mock.calls[putCallIndex];
      expect(putCall[0].input.Item.userId).toBe('PARALLEL_SHARD#u1#t1#t2');
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
