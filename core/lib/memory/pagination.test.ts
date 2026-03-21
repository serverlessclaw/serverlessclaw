import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoMemory } from '../memory';
import { InsightCategory } from '../types/memory';

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DynamoMemory Pagination & Search', () => {
  let memory: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
    memory = new DynamoMemory();
  });

  describe('getMemoryByTypePaginated', () => {
    it('should query the TypeTimestampIndex with pagination', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { userId: 'USER#1', timestamp: 100, content: 'fact 1', type: 'DISTILLED' },
          { userId: 'USER#1', timestamp: 90, content: 'fact 2', type: 'DISTILLED' },
        ],
        LastEvaluatedKey: { userId: 'USER#1', timestamp: 90 },
      });

      const result = await memory.getMemoryByTypePaginated('DISTILLED', 2, {
        userId: 'USER#1',
        timestamp: 110,
      });

      expect(result.items).toHaveLength(2);
      expect(result.lastEvaluatedKey).toEqual({ userId: 'USER#1', timestamp: 90 });

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input).toMatchObject({
        IndexName: 'TypeTimestampIndex',
        KeyConditionExpression: '#type = :type',
        ExpressionAttributeValues: { ':type': 'DISTILLED' },
        Limit: 2,
        ExclusiveStartKey: { userId: 'USER#1', timestamp: 110 },
      });
    });
  });

  describe('searchInsights', () => {
    it('should use ScanCommand for global search with filters', async () => {
      ddbMock.on(ScanCommand).resolves({
        Items: [
          {
            userId: 'GAP#1',
            timestamp: 200,
            content: 'missing tool X',
            metadata: { category: InsightCategory.STRATEGIC_GAP },
          },
          {
            userId: 'LESSON#1',
            timestamp: 150,
            content: 'use tool X with Y',
            metadata: { category: InsightCategory.TACTICAL_LESSON },
          },
        ],
        LastEvaluatedKey: { userId: 'LESSON#1', timestamp: 150 },
      });

      const result = await memory.searchInsights(
        undefined,
        'tool X',
        InsightCategory.STRATEGIC_GAP,
        10
      );

      expect(result.items).toHaveLength(2);
      expect(result.lastEvaluatedKey).toEqual({ userId: 'LESSON#1', timestamp: 150 });

      const calls = ddbMock.commandCalls(ScanCommand);
      expect(calls[0].args[0].input).toMatchObject({
        TableName: 'test-memory-table',
        FilterExpression: 'contains(content, :query) AND metadata.category = :category',
        ExpressionAttributeValues: {
          ':query': 'tool X',
          ':category': InsightCategory.STRATEGIC_GAP,
        },
        Limit: 10,
      });
    });

    it('should handle empty query by returning all items (Scan without query filter)', async () => {
      ddbMock.on(ScanCommand).resolves({
        Items: [{ userId: 'USER#1', timestamp: 100, content: 'some fact' }],
      });

      const result = await memory.searchInsights(undefined, '', undefined, 5);

      expect(result.items).toHaveLength(1);
      const calls = ddbMock.commandCalls(ScanCommand);
      expect(calls[0].args[0].input.FilterExpression).toBeUndefined();
      expect(calls[0].args[0].input.Limit).toBe(5);
    });

    it('should properly map items to MemoryInsight objects', async () => {
      ddbMock.on(ScanCommand).resolves({
        Items: [
          {
            userId: 'DISTILLED#user1',
            timestamp: 123,
            content: 'pref 1',
            metadata: { priority: 10, category: InsightCategory.USER_PREFERENCE },
          },
        ],
      });

      const result = await memory.searchInsights(undefined, 'pref');

      expect(result.items[0]).toEqual({
        id: 'DISTILLED#user1',
        content: 'pref 1',
        timestamp: 123,
        metadata: {
          priority: 10,
          category: InsightCategory.USER_PREFERENCE,
        },
      });
    });
  });
});
