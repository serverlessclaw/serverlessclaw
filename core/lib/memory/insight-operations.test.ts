import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoMemory } from '../memory';
import { InsightCategory } from '../types/memory';

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Insight Operations', () => {
  let memory: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
    memory = new DynamoMemory();
  });

  describe('addMemory', () => {
    it('should include createdAt in putItem and metadata', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      const UpdateCommand = (await import('@aws-sdk/lib-dynamodb')).UpdateCommand;
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      await memory.addMemory('USER#123', InsightCategory.USER_PREFERENCE, 'test memory');

      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls).toHaveLength(1);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);

      const item = putCalls[0].args[0].input.Item;
      expect(item?.userId).toBe('USER#123');
      expect(item?.timestamp).toBe(now);
      expect(item?.createdAt).toBe(now);

      vi.useRealTimers();
    });
  });

  describe('addLesson', () => {
    it('should include createdAt in putItem and metadata', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      ddbMock.on(PutCommand).resolves({});

      await memory.addLesson('user123', 'test lesson');

      const calls = ddbMock.commandCalls(PutCommand);
      const item = calls[0].args[0].input.Item;
      expect(item?.timestamp).toBe(now);
      expect(item?.createdAt).toBe(now);

      vi.useRealTimers();
    });
  });

  describe('addGlobalLesson', () => {
    it('should include createdAt in putItem and metadata', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      ddbMock.on(PutCommand).resolves({});

      await memory.addGlobalLesson('test global lesson');

      const calls = ddbMock.commandCalls(PutCommand);
      const item = calls[0].args[0].input.Item;
      expect(item?.timestamp).toBe(now);
      expect(item?.createdAt).toBe(now);

      vi.useRealTimers();
    });
  });

  describe('recordFailedPlan', () => {
    it('should include createdAt in putItem and metadata', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      ddbMock.on(PutCommand).resolves({});

      await memory.recordFailedPlan('hash123', 'plan content', ['gap1'], 'reason');

      const calls = ddbMock.commandCalls(PutCommand);
      const item = calls[0].args[0].input.Item;
      expect(item?.timestamp).toBe(now);
      expect(item?.createdAt).toBe(now);

      vi.useRealTimers();
    });
  });

  describe('searchInsights', () => {
    it('should use UserInsightIndex when userId and category are provided', async () => {
      const timestamp = 1000;
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'USER#1',
            content: 'Test content',
            timestamp,
            type: 'MEMORY:USER_PREFERENCE',
            metadata: { category: InsightCategory.USER_PREFERENCE },
          },
        ],
      });

      await memory.searchInsights('USER#1', '', InsightCategory.USER_PREFERENCE);

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.IndexName).toBe('UserInsightIndex');
      expect(calls[0].args[0].input.KeyConditionExpression).toContain('#uid = :userId');
      expect(calls[0].args[0].input.KeyConditionExpression).toContain('#tp = :type');
    });

    it('should map items with createdAt correctly', async () => {
      const timestamp = 1000;
      const createdAt = 500;

      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'USER#1',
            content: 'Test content',
            timestamp,
            createdAt,
            type: 'MEMORY:USER_PREFERENCE',
            metadata: { category: InsightCategory.USER_PREFERENCE },
          },
        ],
      });

      const { items } = await memory.searchInsights('USER#1');

      expect(items[0].createdAt).toBe(createdAt);
      expect(items[0].timestamp).toBe(timestamp);
    });
    it('should perform hierarchical search (User -> Org -> Global) when all IDs are provided', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [],
      });

      await memory.searchInsights(
        'USER#1',
        'test query',
        InsightCategory.TACTICAL_LESSON,
        50,
        undefined,
        [],
        'ORG-1'
      );

      const calls = ddbMock.commandCalls(QueryCommand);
      // We expect 3 calls: USER#1, ORG#ORG-1, and SYSTEM#GLOBAL
      expect(calls).toHaveLength(3);

      expect(calls[0].args[0].input.ExpressionAttributeValues?.[':userId']).toBe('USER#1');
      expect(calls[1].args[0].input.ExpressionAttributeValues?.[':userId']).toBe('ORG#ORG-1');
      expect(calls[2].args[0].input.ExpressionAttributeValues?.[':userId']).toBe('SYSTEM#GLOBAL');

      expect(calls[0].args[0].input.IndexName).toBe('UserInsightIndex');
    });
  });
});
