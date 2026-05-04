import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  BatchWriteCommand,
  DeleteCommand,
  UpdateCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { BaseMemoryProvider } from './base';

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: {
      name: 'TestMemoryTable',
    },
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('BaseMemoryProvider', () => {
  let provider: BaseMemoryProvider;

  beforeEach(() => {
    ddbMock.reset();
    provider = new BaseMemoryProvider(ddbMock as any);
  });

  describe('scanByPrefix', () => {
    it('should return items matching the prefix', async () => {
      const mockItems = [
        { userId: 'GAP#1', content: 'Gap 1' },
        { userId: 'GAP#2', content: 'Gap 2' },
      ];

      ddbMock.on(ScanCommand).resolves({
        Items: mockItems,
      });

      const result = await provider.scanByPrefix('GAP#');

      expect(result).toEqual(mockItems);
      expect(ddbMock.calls()).toHaveLength(1);

      const call = ddbMock.call(0);
      expect(call.args[0].input).toMatchObject({
        FilterExpression: 'begins_with(userId, :prefix)',
        ExpressionAttributeValues: {
          ':prefix': 'GAP#',
        },
      });
    });

    it('should re-throw error on DynamoDB failure', async () => {
      ddbMock.on(ScanCommand).rejects(new Error('DynamoDB Error'));

      await expect(provider.scanByPrefix('GAP#')).rejects.toThrow('DynamoDB Error');
    });

    it('should return empty array if no items found', async () => {
      ddbMock.on(ScanCommand).resolves({
        Items: undefined,
      });

      const result = await provider.scanByPrefix('NONEXISTENT#');

      expect(result).toEqual([]);
    });
  });

  describe('clearHistory', () => {
    it('should batch delete items in groups of 25', async () => {
      // Create 50 mock items (should result in 2 batch writes)
      const mockItems = Array.from({ length: 50 }, (_, i) => ({
        userId: `user123`,
        timestamp: 1000 + i,
        content: `Message ${i}`,
      }));

      ddbMock.on(QueryCommand).resolves({
        Items: mockItems,
      });

      ddbMock.on(BatchWriteCommand).resolves({});

      await provider.clearHistory('user123');

      // Should have called BatchWriteCommand twice (50 items / 25 per batch = 2 batches)
      expect(ddbMock.calls()).toHaveLength(3); // 1 QueryCommand + 2 BatchWriteCommand

      // Verify first batch has 25 items
      const firstBatchCall = ddbMock.call(1);
      expect((firstBatchCall.args[0].input as any).RequestItems.TestMemoryTable).toHaveLength(25);

      // Verify second batch has 25 items
      const secondBatchCall = ddbMock.call(2);
      expect((secondBatchCall.args[0].input as any).RequestItems.TestMemoryTable).toHaveLength(25);
    });

    it('should handle items not divisible by 25', async () => {
      // Create 37 mock items (should result in 2 batch writes: 25 + 12)
      const mockItems = Array.from({ length: 37 }, (_, i) => ({
        userId: `user123`,
        timestamp: 1000 + i,
        content: `Message ${i}`,
      }));

      ddbMock.on(QueryCommand).resolves({
        Items: mockItems,
      });

      ddbMock.on(BatchWriteCommand).resolves({});

      await provider.clearHistory('user123');

      // Should have called BatchWriteCommand twice
      expect(ddbMock.calls()).toHaveLength(3); // 1 QueryCommand + 2 BatchWriteCommand

      // Verify first batch has 25 items
      const firstBatchCall = ddbMock.call(1);
      expect((firstBatchCall.args[0].input as any).RequestItems.TestMemoryTable).toHaveLength(25);

      // Verify second batch has 12 items
      const secondBatchCall = ddbMock.call(2);
      expect((secondBatchCall.args[0].input as any).RequestItems.TestMemoryTable).toHaveLength(12);
    });

    it('should handle empty history gracefully', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [],
      });

      await provider.clearHistory('user123');

      // Should only have called QueryCommand, no BatchWriteCommand
      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('should construct correct delete requests', async () => {
      const mockItems = [
        { userId: 'user123', timestamp: 1000, content: 'Message 1' },
        { userId: 'user123', timestamp: 2000, content: 'Message 2' },
      ];

      ddbMock.on(QueryCommand).resolves({
        Items: mockItems,
      });

      ddbMock.on(BatchWriteCommand).resolves({});

      await provider.clearHistory('user123');

      const batchCall = ddbMock.call(1);
      const deleteRequests = (batchCall.args[0].input as any).RequestItems.TestMemoryTable;

      expect(deleteRequests).toEqual([
        { DeleteRequest: { Key: { userId: 'user123', timestamp: 1000 } } },
        { DeleteRequest: { Key: { userId: 'user123', timestamp: 2000 } } },
      ]);
    });
  });

  describe('getHistory', () => {
    it('should map items to Message objects with all optional fields', async () => {
      const mockItems = [
        {
          role: 'user',
          content: 'Hello',
          thought: 'User greeting',
          tool_calls: [
            { id: 'tc1', type: 'function', function: { name: 'test', arguments: '{}' } },
          ],
          tool_call_id: 'tc1',
          name: 'testAgent',
          agentName: 'AgentA',
          traceId: 'trace-123',
        },
        {
          role: 'assistant',
          content: 'Hi there',
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockItems });

      const result = await provider.getHistory('user123');

      expect(result).toEqual([
        expect.objectContaining({
          role: 'user',
          content: 'Hello',
          thought: 'User greeting',
          tool_calls: [
            { id: 'tc1', type: 'function', function: { name: 'test', arguments: '{}' } },
          ],
          attachments: [],
          tool_call_id: 'tc1',
          name: 'testAgent',
          agentName: 'AgentA',
          traceId: 'trace-123',
        }),
        expect.objectContaining({
          role: 'assistant',
          content: 'Hi there',
          thought: undefined,
          tool_calls: [],
          attachments: [],
          tool_call_id: undefined,
          name: undefined,
          agentName: undefined,
          traceId: expect.stringMatching(/^legacy-\d+$/),
        }),
      ]);

      const call = ddbMock.call(0);
      expect(call.args[0].input).toMatchObject({
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': 'user123' },
        ScanIndexForward: true,
      });
    });

    it('should return empty array for no results', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await provider.getHistory('user123');

      expect(result).toEqual([]);
    });

    it('should handle pagination with LastEvaluatedKey', async () => {
      const page1Items = [
        { role: 'user', content: 'Msg 1' },
        { role: 'assistant', content: 'Msg 2' },
      ];
      const page2Items = [{ role: 'user', content: 'Msg 3' }];

      ddbMock
        .on(QueryCommand)
        .resolvesOnce({
          Items: page1Items,
          LastEvaluatedKey: { userId: 'user123', timestamp: 1002 },
        })
        .resolvesOnce({ Items: page2Items });

      const result = await provider.getHistory('user123');

      expect(result).toEqual([
        expect.objectContaining({
          role: 'user',
          content: 'Msg 1',
          traceId: expect.stringMatching(/^legacy-\d+$/),
        }),
        expect.objectContaining({
          role: 'assistant',
          content: 'Msg 2',
          traceId: expect.stringMatching(/^legacy-\d+$/),
        }),
      ]);
    });
  });

  describe('getDistilledMemory', () => {
    it('should return content when distilled memory is found', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ content: 'Distilled memory content' }],
      });

      const result = await provider.getDistilledMemory('user123');

      expect(result).toBe('Distilled memory content');

      const call = ddbMock.call(0);
      expect(call.args[0].input).toMatchObject({
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': 'DISTILLED#user123' },
        ScanIndexForward: false,
        Limit: 1,
      });
    });

    it('should return empty string when distilled memory is not found', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await provider.getDistilledMemory('user123');

      expect(result).toBe('');
    });
  });

  describe('listConversations', () => {
    it('should map items with isPinned and expiresAt fields', async () => {
      const mockItems = [
        {
          sessionId: 'session-1',
          title: 'Chat 1',
          content: 'Last message',
          timestamp: 1000,
          isPinned: true,
          expiresAt: 2000,
        },
        {
          sessionId: 'session-2',
          title: 'Chat 2',
          content: 'Another message',
          timestamp: 900,
          isPinned: false,
        },
      ];

      ddbMock.on(QueryCommand).resolves({ Items: mockItems });

      const result = await provider.listConversations('user123');

      expect(result).toEqual([
        {
          sessionId: 'session-1',
          title: 'Chat 1',
          lastMessage: 'Last message',
          updatedAt: 1000,
          isPinned: true,
          expiresAt: 2000,
        },
        {
          sessionId: 'session-2',
          title: 'Chat 2',
          lastMessage: 'Another message',
          updatedAt: 900,
          isPinned: false,
          expiresAt: undefined,
        },
      ]);

      const call = ddbMock.call(0);
      expect(call.args[0].input).toMatchObject({
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': 'SESSIONS#user123' },
        ScanIndexForward: false,
      });
    });

    it('should return empty array for no conversations', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await provider.listConversations('user123');

      expect(result).toEqual([]);
    });
  });

  describe('deleteItem', () => {
    it('should successfully delete an item', async () => {
      ddbMock.on(DeleteCommand).resolves({});

      await provider.deleteItem({ userId: 'user123', timestamp: 1000 });

      const call = ddbMock.call(0);
      expect(call.args[0].input).toMatchObject({
        TableName: 'TestMemoryTable',
        Key: { userId: 'user123', timestamp: 1000 },
      });
    });

    it('should re-throw ConditionalCheckFailedException', async () => {
      const conditionalError = new Error('Condition check failed');
      conditionalError.name = 'ConditionalCheckFailedException';
      ddbMock.on(DeleteCommand).rejects(conditionalError);

      await expect(provider.deleteItem({ userId: 'user123', timestamp: 1000 })).rejects.toThrow(
        'Condition check failed'
      );
    });

    it('should re-throw other errors', async () => {
      ddbMock.on(DeleteCommand).rejects(new Error('DynamoDB Error'));

      await expect(provider.deleteItem({ userId: 'user123', timestamp: 1000 })).rejects.toThrow(
        'DynamoDB Error'
      );
    });
  });

  describe('updateItem', () => {
    it('should successfully update an item', async () => {
      const mockOutput = { Attributes: { userId: 'user123', content: 'Updated' } };
      ddbMock.on(UpdateCommand).resolves(mockOutput);

      const params = {
        Key: { userId: 'user123', timestamp: 1000 },
        UpdateExpression: 'SET content = :content',
        ExpressionAttributeValues: { ':content': 'Updated' },
      };

      const result = await provider.updateItem(params);

      expect(result).toEqual(mockOutput);

      const call = ddbMock.call(0);
      expect(call.args[0].input).toMatchObject({
        TableName: 'TestMemoryTable',
        Key: { userId: 'user123', timestamp: 1000 },
        UpdateExpression: 'SET content = :content',
        ExpressionAttributeValues: { ':content': 'Updated' },
      });
    });

    it('should propagate errors', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('Update failed'));

      const params = {
        Key: { userId: 'user123', timestamp: 1000 },
        UpdateExpression: 'SET content = :content',
        ExpressionAttributeValues: { ':content': 'Updated' },
      };

      await expect(provider.updateItem(params)).rejects.toThrow('Update failed');
    });
  });

  describe('queryItemsPaginated', () => {
    it('should return items and LastEvaluatedKey across multiple pages', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({
          Items: [{ role: 'user', content: 'Page 1' }],
          LastEvaluatedKey: { userId: 'user123', timestamp: 1001 },
        })
        .resolvesOnce({
          Items: [{ role: 'assistant', content: 'Page 2' }],
          LastEvaluatedKey: undefined,
        });

      const page1 = await provider.queryItemsPaginated({
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': 'user123' },
      });

      expect(page1.items).toEqual([{ role: 'user', content: 'Page 1' }]);
      expect(page1.lastEvaluatedKey).toEqual({ userId: 'user123', timestamp: 1001 });

      const page2 = await provider.queryItemsPaginated({
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': 'user123' },
        ExclusiveStartKey: page1.lastEvaluatedKey,
      });

      expect(page2.items).toEqual([{ role: 'assistant', content: 'Page 2' }]);
      expect(page2.lastEvaluatedKey).toBeUndefined();
    });

    it('should propagate errors', async () => {
      ddbMock.on(QueryCommand).rejects(new Error('Query failed'));

      await expect(
        provider.queryItemsPaginated({
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: { ':userId': 'user123' },
        })
      ).rejects.toThrow('Query failed');
    });
  });

  describe('putItem', () => {
    it('should successfully put an item', async () => {
      ddbMock.on(PutCommand).resolves({});

      const item = { userId: 'user123', timestamp: 1000, content: 'Test content' };
      await provider.putItem(item);

      const call = ddbMock.call(0);
      expect(call.args[0].input).toMatchObject({
        TableName: 'TestMemoryTable',
        Item: item,
      });
    });

    it('should propagate errors', async () => {
      ddbMock.on(PutCommand).rejects(new Error('Put failed'));

      const item = { userId: 'user123', timestamp: 1000, content: 'Test content' };
      await expect(provider.putItem(item)).rejects.toThrow('Put failed');
    });
  });

  describe('tableName getter', () => {
    it('should return fallback when Resource.MemoryTable is undefined', async () => {
      vi.resetModules();
      vi.doMock('sst', () => ({
        Resource: {},
      }));

      const { BaseMemoryProvider: BMP } = await import('./base');
      const localProvider = new BMP(ddbMock as any);

      const mockItems = [{ role: 'user', content: 'test' }];
      ddbMock.on(QueryCommand).resolves({ Items: mockItems });

      await localProvider.getHistory('user123');

      expect(ddbMock.calls()).toHaveLength(0);

      await localProvider.deleteItem({ userId: 'user123', timestamp: 1000 });
      expect(ddbMock.calls()).toHaveLength(0);

      const updateResult = await localProvider.updateItem({
        Key: { userId: 'user123', timestamp: 1000 },
      });
      expect(updateResult).toBeUndefined();
      expect(ddbMock.calls()).toHaveLength(0);

      const scanResult = await localProvider.scanByPrefix('GAP#');
      expect(scanResult).toEqual([]);
      expect(ddbMock.calls()).toHaveLength(0);

      vi.doUnmock('sst');
    });
  });
});
