import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoMemory } from './dynamo-memory';
import { searchInsights } from './insight-operations';
import { InsightCategory } from '../types/memory';

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Memory Leakage & Visibility Audit (Post-Fix)', () => {
  let memory: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
    memory = new DynamoMemory();
  });

  describe('searchInsights Isolation', () => {
    it('should NOT leak other workspaces when workspaceId is missing', async () => {
      // Mock GSI return with items from different workspaces
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'SYSTEM#GLOBAL',
            timestamp: 3,
            type: 'MEMORY:INSIGHT',
            content: 'Truly global fact',
            workspaceId: undefined,
          },
        ],
      });

      const result = await searchInsights(memory, {
        category: InsightCategory.SYSTEM_KNOWLEDGE,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].content).toBe('Truly global fact');

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.FilterExpression).toContain(
        'attribute_not_exists(workspaceId)'
      );
    });

    it('should INCLUDE global lessons when a workspaceId is provided (Trust Loop)', async () => {
      // Mock GSI return
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'WS#WS1#SYSTEM#GLOBAL',
            timestamp: 1,
            type: 'MEMORY:INSIGHT',
            content: 'WS1 local lesson',
            workspaceId: 'WS1',
          },
          {
            userId: 'SYSTEM#GLOBAL',
            timestamp: 3,
            type: 'MEMORY:INSIGHT',
            content: 'Truly global lesson',
            workspaceId: undefined,
          },
        ],
      });

      const result = await searchInsights(memory, {
        category: InsightCategory.SYSTEM_KNOWLEDGE,
        scope: { workspaceId: 'WS1' },
      });

      expect(result.items.length).toBe(2);
      expect(result.items.find((i) => i.content === 'WS1 local lesson')).toBeDefined();
      expect(result.items.find((i) => i.content === 'Truly global lesson')).toBeDefined();

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.FilterExpression).toContain('workspaceId = :workspaceId');
    });

    it('should INCLUDE truly global items when searching with resolvedUserId and orgId', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'SYSTEM#GLOBAL',
            timestamp: 1,
            type: 'MEMORY:INSIGHT',
            content: 'Truly global fact',
            workspaceId: undefined,
          },
        ],
      });

      const result = await searchInsights(
        memory,
        {
          userId: 'USER123',
          scope: { workspaceId: 'WS1' },
        },
        undefined,
        undefined,
        50,
        undefined,
        undefined,
        'ORG123'
      );

      expect(result.items.length).toBeGreaterThan(0);

      const calls = ddbMock.calls();
      const queriedUserIds = calls.map(
        (c) => (c.args[0].input as Record<string, any>).ExpressionAttributeValues[':userId']
      );
      expect(queriedUserIds).toContain('SYSTEM#GLOBAL');
      expect(queriedUserIds).toContain('ORG#ORG123');
    });
  });
});
