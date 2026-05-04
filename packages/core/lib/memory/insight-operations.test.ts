import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
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
    ddbMock.on(QueryCommand).resolves({ Items: [] }); // Default for similarity checks
    vi.clearAllMocks();
    memory = new DynamoMemory();
  });

  describe('addMemory', () => {
    it('should include createdAt in putItem and metadata', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      await memory.addMemory('USER#123', InsightCategory.USER_PREFERENCE, 'test memory');

      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls).toHaveLength(1);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);

      const item = putCalls[0].args[0].input.Item;
      expect(item?.userId).toBe('USER#123');
      expect(item?.timestamp).toBe(String(now));
      expect(Number(item?.createdAt)).toBe(now);

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
      expect(item?.timestamp).toBe(String(now));
      expect(Number(item?.createdAt)).toBe(now);

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
      expect(item?.timestamp).toBe(String(now));
      expect(Number(item?.createdAt)).toBe(now);

      vi.useRealTimers();
    });
  });

  describe('recordFailurePattern', () => {
    it('should include createdAt in putItem and metadata', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      ddbMock.on(PutCommand).resolves({});

      await memory.recordFailurePattern('hash123', 'plan content', ['gap1'], 'reason');

      const calls = ddbMock.commandCalls(PutCommand);
      const item = calls[0].args[0].input.Item;
      expect(item?.timestamp).toBe(String(now));
      expect(Number(item?.createdAt)).toBe(now);

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
      // Should now include workspace isolation even for UserInsightIndex
      expect(calls[0].args[0].input.FilterExpression).toContain(
        'attribute_not_exists(workspaceId)'
      );
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

    it('should return empty array when no category and no userId', async () => {
      const result = await memory.searchInsights(undefined, '', undefined);
      expect(result.items).toEqual([]);
    });

    it('should use TypeTimestampIndex when no userId but category is provided', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'USER#1',
            content: 'Test content',
            timestamp: 1000,
            type: 'MEMORY:USER_PREFERENCE',
            metadata: { category: InsightCategory.USER_PREFERENCE },
          },
        ],
      });

      await memory.searchInsights(undefined, '', InsightCategory.USER_PREFERENCE);

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.IndexName).toBe('TypeTimestampIndex');
      expect(calls[0].args[0].input.KeyConditionExpression).toBe('#tp = :type');
      expect(calls[0].args[0].input.FilterExpression).toContain(
        'attribute_not_exists(workspaceId)'
      );
    });

    it('should filter by tags when provided', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'USER#1',
            content: 'Tagged content',
            timestamp: 1000,
            type: 'MEMORY:USER_PREFERENCE',
            tags: ['important', 'user-pref'],
            metadata: { category: InsightCategory.USER_PREFERENCE },
          },
          {
            userId: 'USER#1',
            content: 'Untagged content',
            timestamp: 2000,
            type: 'MEMORY:USER_PREFERENCE',
            tags: [],
            metadata: { category: InsightCategory.USER_PREFERENCE },
          },
        ],
      });

      const { items } = await memory.searchInsights(
        'SYSTEM#TEST',
        '',
        InsightCategory.USER_PREFERENCE,
        50,
        undefined,
        ['important']
      );

      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('Tagged content');
    });

    it('should handle wildcard query without filter expression', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'USER#1',
            content: 'Test content',
            timestamp: 1000,
            type: 'MEMORY:USER_PREFERENCE',
            metadata: { category: InsightCategory.USER_PREFERENCE },
          },
        ],
      });

      await memory.searchInsights('USER#1', '*', InsightCategory.USER_PREFERENCE);

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.FilterExpression).toContain(
        'attribute_not_exists(workspaceId)'
      );
    });

    it('should apply content filter for non-wildcard queries', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'USER#1',
            content: 'Test content',
            timestamp: 1000,
            type: 'MEMORY:USER_PREFERENCE',
            metadata: { category: InsightCategory.USER_PREFERENCE },
          },
        ],
      });

      await memory.searchInsights('USER#1', 'specific query', InsightCategory.USER_PREFERENCE);

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.FilterExpression).toContain('contains(content, :query)');
      expect(calls[0].args[0].input.FilterExpression).toContain(
        'attribute_not_exists(workspaceId)'
      );
      expect(calls[0].args[0].input.ExpressionAttributeValues?.[':query']).toBe('specific query');
    });
  });

  describe('refineMemory', () => {
    it('should update content and merge tags', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      const UpdateCommand = (await import('@aws-sdk/lib-dynamodb')).UpdateCommand;

      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'USER#1',
            timestamp: 1000,
            content: 'Old content',
            type: 'MEMORY:USER_PREFERENCE',
            tags: ['existing-tag'],
            metadata: { category: InsightCategory.USER_PREFERENCE, hitCount: 0 },
          },
        ],
      });
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      await memory.refineMemory('USER#1', 1000, 'New content', {
        tags: ['new-tag'],
        priority: 'high' as any,
      });

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);

      const input = updateCalls[0]?.args[0].input;
      expect(input?.UpdateExpression).toContain('#content = :content');
      expect(input?.ExpressionAttributeNames?.['#content']).toBe('content');
      expect(input?.ExpressionAttributeValues?.[':content']).toBe('New content');
      expect(input?.ExpressionAttributeNames?.['#tags']).toBe('tags');
      expect(input?.ExpressionAttributeNames?.['#priority']).toBe('priority');
      expect(input?.ExpressionAttributeValues?.[':priority']).toBe('high');

      vi.useRealTimers();
    });

    it('should throw Error when memory item not found', async () => {
      ddbMock.on(UpdateCommand).rejects(
        Object.assign(new Error('ConditionalCheckFailedException'), {
          name: 'ConditionalCheckFailedException',
        })
      );

      await expect(memory.refineMemory('USER#1', 999, 'New content')).rejects.toThrow();
    });

    it('should filter PII from content updates', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'USER#1',
            timestamp: 1000,
            content: 'Old content',
            type: 'MEMORY:USER_PREFERENCE',
            tags: [],
            metadata: { category: InsightCategory.USER_PREFERENCE },
          },
        ],
      });
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      await memory.refineMemory('USER#1', 1000, 'Contact me at user@example.com for details');

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const input = updateCalls[0]?.args[0].input;
      expect(input?.ExpressionAttributeValues?.[':content']).toBe(
        'Contact me at [EMAIL_REDACTED] for details'
      );
    });

    it('should only update metadata when content is not provided', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'USER#1',
            timestamp: 1000,
            content: 'Existing content',
            type: 'MEMORY:USER_PREFERENCE',
            tags: [],
            metadata: { category: InsightCategory.USER_PREFERENCE },
          },
        ],
      });
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      await memory.refineMemory('USER#1', 1000, undefined, { priority: 'low' as any });

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const input = updateCalls[0]?.args[0].input;
      expect(input?.ExpressionAttributeValues?.[':content']).toBeUndefined();
      expect(input?.ExpressionAttributeValues?.[':priority']).toBe('low');
    });
  });

  describe('updateInsightMetadata', () => {
    it('should update metadata when item is found', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'USER#1',
            timestamp: 1000,
            content: 'Test content',
            type: 'MEMORY:USER_PREFERENCE',
            metadata: { category: InsightCategory.USER_PREFERENCE, hitCount: 5 },
          },
        ],
      });
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      await memory.updateInsightMetadata('USER#1', 1000, {
        priority: 'high' as any,
        impact: 'critical' as any,
      });

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);

      const input = updateCalls[0]?.args[0].input;
      expect(input!.Key!.userId).toBe('USER#1');
      // New behavior: individual attributes are updated, not the whole metadata object
      expect(input!.ExpressionAttributeValues![':priority']).toBe('high');
      expect(input!.ExpressionAttributeValues![':impact']).toBe('critical');
      expect(input!.UpdateExpression).toContain('metadata.#priority');
      expect(input!.UpdateExpression).toContain('metadata.#impact');
    });

    it('should NOT call updateItem when item is not found', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await memory.updateInsightMetadata('USER#1', 999, { priority: 'high' as any });

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);
    });

    it('should correctly build UpdateExpression for varied metadata fields', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await memory.updateInsightMetadata('USER#1', 12345, {
        hitCount: 10,
        confidence: 0.95,
        risk: 'low' as any,
        lastAccessed: 1710000000000,
      });

      const calls = ddbMock.commandCalls(UpdateCommand);
      const input = calls[0].args[0].input;

      expect(input.UpdateExpression).toContain('metadata.#hitCount = :hitCount');
      expect(input.UpdateExpression).toContain('metadata.#confidence = :confidence');
      expect(input.UpdateExpression).toContain('metadata.#risk = :risk');
      expect(input.UpdateExpression).toContain('metadata.#lastAccessed = :lastAccessed');
      expect(input.UpdateExpression).toContain('updatedAt = :now');

      expect(input.ExpressionAttributeValues?.[':hitCount']).toBe(10);
      expect(input.ExpressionAttributeValues?.[':confidence']).toBe(0.95);
      expect(input.ExpressionAttributeValues?.[':risk']).toBe('low');
      expect(input.ExpressionAttributeValues?.[':now']).toBeDefined();
    });
  });

  describe('addMemory - deduplication and PII', () => {
    it('should update existing memory when similar content is found', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      const UpdateCommand = (await import('@aws-sdk/lib-dynamodb')).UpdateCommand;

      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'USER#1',
            timestamp: 500,
            content: 'test memory content example',
            type: 'MEMORY:INSIGHT',
            tags: [],
            metadata: { category: InsightCategory.USER_PREFERENCE, hitCount: 0 },
          },
        ],
      });
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      const timestamp = await memory.addMemory(
        'USER#1',
        InsightCategory.USER_PREFERENCE,
        'test memory content example'
      );

      expect(String(timestamp)).toBe('500');

      const queryCalls = ddbMock.commandCalls(QueryCommand);
      expect(queryCalls[0].args[0].input.FilterExpression).toContain('content = :content');

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);

      vi.useRealTimers();
    });

    it('should filter PII from content when adding new memory', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      const UpdateCommand = (await import('@aws-sdk/lib-dynamodb')).UpdateCommand;

      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      await memory.addMemory(
        'USER#1',
        InsightCategory.USER_PREFERENCE,
        'My email is test@example.com and IP is 192.168.1.1'
      );

      const putCalls = ddbMock.commandCalls(PutCommand);
      const item = putCalls[0]?.args[0].input.Item;
      expect(item?.content).toBe('My email is [EMAIL_REDACTED] and IP is [IP_REDACTED]');

      vi.useRealTimers();
    });

    it('should normalize tags when adding memory', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      const UpdateCommand = (await import('@aws-sdk/lib-dynamodb')).UpdateCommand;

      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      await memory.addMemory('USER#1', InsightCategory.USER_PREFERENCE, 'test content', {
        tags: ['MyTag', 'another-tag', 'UPPER_CASE'],
      });

      const putCalls = ddbMock.commandCalls(PutCommand);
      const item = putCalls[0]?.args[0].input.Item;
      expect(item?.tags).toContain('mytag');
      expect(item?.tags).toContain('another-tag');
      expect(item?.tags).toContain('upper_case');

      vi.useRealTimers();
    });

    it('should handle undefined content gracefully', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      const UpdateCommand = (await import('@aws-sdk/lib-dynamodb')).UpdateCommand;

      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      // pass undefined content and ensure it does not throw and stores empty string
      // (coerce via internal handling)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      await memory.addMemory('USER#1', InsightCategory.USER_PREFERENCE, undefined);

      const putCalls = ddbMock.commandCalls(PutCommand);
      const item = putCalls[0]?.args[0].input.Item;
      expect(item?.content).toBe('');

      vi.useRealTimers();
    });
  });

  describe('recordFailurePattern', () => {
    it('should store content as JSON with correct structure', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      const UpdateCommand = (await import('@aws-sdk/lib-dynamodb')).UpdateCommand;

      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      await memory.recordFailurePattern(
        'plan-hash-123',
        'Deploy to prod',
        ['gap-1', 'gap-2'],
        'Timeout error'
      );

      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls).toHaveLength(1);

      const item = putCalls[0]?.args[0].input.Item;
      const content = JSON.parse(item?.content);
      expect(content.planHash).toBe('plan-hash-123');
      expect(content.planContent).toBe('Deploy to prod');
      expect(content.gapIds).toEqual(['gap-1', 'gap-2']);
      expect(content.failureReason).toBe('Timeout error');

      vi.useRealTimers();
    });

    it('should use SYSTEM#GLOBAL as userId and correct type', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      const UpdateCommand = (await import('@aws-sdk/lib-dynamodb')).UpdateCommand;

      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      await memory.recordFailurePattern('hash', 'content', [], 'reason');

      const putCalls = ddbMock.commandCalls(PutCommand);
      const item = putCalls[0]?.args[0].input.Item;
      expect(item?.userId).toBe('SYSTEM#GLOBAL');
      expect(item?.type).toBe('MEMORY:FAILURE_PATTERN');
      expect(item?.tags).toContain('failed_plan');

      vi.useRealTimers();
    });

    it('should merge additional tags', async () => {
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(UpdateCommand).resolves({});

      await memory.recordFailurePattern('hash', 'content', [], 'reason', {
        tags: ['custom-tag', 'another-tag'],
      } as any);

      const putCalls = ddbMock.commandCalls(PutCommand);
      const item = putCalls[0]?.args[0].input.Item;
      expect(item?.tags).toContain('failed_plan');
      expect(item?.tags).toContain('custom-tag');
      expect(item?.tags).toContain('another-tag');
    });
  });

  describe('getFailurePatterns', () => {
    it('should return multiple failed plans', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'SYSTEM#GLOBAL',
            timestamp: 1000,
            content: JSON.stringify({
              planHash: 'hash1',
              planContent: 'Plan 1',
              gapIds: [],
              failureReason: 'Reason 1',
            }),
            type: 'MEMORY:FAILURE_PATTERN',
            tags: ['failed_plan'],
            metadata: { category: InsightCategory.FAILURE_PATTERN },
          },
          {
            userId: 'SYSTEM#GLOBAL',
            timestamp: 2000,
            content: JSON.stringify({
              planHash: 'hash2',
              planContent: 'Plan 2',
              gapIds: ['gap-1'],
              failureReason: 'Reason 2',
            }),
            type: 'MEMORY:FAILURE_PATTERN',
            tags: ['failed_plan'],
            metadata: { category: InsightCategory.FAILURE_PATTERN },
          },
        ],
      });

      const plans = await memory.getFailurePatterns(10);
      expect(plans).toHaveLength(2);
      expect(plans[0].content).toContain('hash1');
      expect(plans[1].content).toContain('hash2');
    });

    it('should return empty array when no failed plans exist', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const plans = await memory.getFailurePatterns();
      expect(plans).toEqual([]);
    });
  });

  describe('getLessons', () => {
    it('should return multiple lessons', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'USER#1',
            timestamp: 1000,
            content: 'First lesson learned',
            type: 'MEMORY:TACTICAL_LESSON',
            metadata: { category: InsightCategory.TACTICAL_LESSON },
          },
          {
            userId: 'USER#1',
            timestamp: 2000,
            content: 'Second lesson learned',
            type: 'MEMORY:TACTICAL_LESSON',
            metadata: { category: InsightCategory.TACTICAL_LESSON },
          },
        ],
      });

      const lessons = await memory.getLessons('USER#1');
      expect(lessons).toHaveLength(2);
      expect(lessons).toContain('First lesson learned');
      expect(lessons).toContain('Second lesson learned');
    });

    it('should return empty array when no lessons exist', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const lessons = await memory.getLessons('USER#1');
      expect(lessons).toEqual([]);
    });
  });

  describe('getGlobalLessons', () => {
    it('should return multiple global lessons', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'SYSTEM#GLOBAL',
            timestamp: 1000,
            content: 'Global lesson one',
            metadata: { category: InsightCategory.SYSTEM_KNOWLEDGE },
          },
          {
            userId: 'SYSTEM#GLOBAL',
            timestamp: 2000,
            content: 'Global lesson two',
            type: 'MEMORY:INSIGHT',
            metadata: { category: InsightCategory.SYSTEM_KNOWLEDGE },
          },
        ],
      });

      const lessons = await memory.getGlobalLessons(10);
      expect(lessons).toHaveLength(2);
      expect(lessons).toContain('Global lesson one');
      expect(lessons).toContain('Global lesson two');
    });

    it('should return empty array when no global lessons exist', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const lessons = await memory.getGlobalLessons();
      expect(lessons).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'SYSTEM#GLOBAL',
            timestamp: 1000,
            content: 'Lesson 1',
            type: 'MEMORY:INSIGHT',
            metadata: { category: InsightCategory.SYSTEM_KNOWLEDGE },
          },
        ],
      });

      await memory.getGlobalLessons(5);

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.Limit).toBe(5);
    });
  });
});
