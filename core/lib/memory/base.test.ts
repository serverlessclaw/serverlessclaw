import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  BatchWriteCommand,
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

    it('should return empty array on error', async () => {
      ddbMock.on(ScanCommand).rejects(new Error('DynamoDB Error'));

      const result = await provider.scanByPrefix('GAP#');

      expect(result).toEqual([]);
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
      expect(firstBatchCall.args[0].input.RequestItems.TestMemoryTable).toHaveLength(25);

      // Verify second batch has 25 items
      const secondBatchCall = ddbMock.call(2);
      expect(secondBatchCall.args[0].input.RequestItems.TestMemoryTable).toHaveLength(25);
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
      expect(firstBatchCall.args[0].input.RequestItems.TestMemoryTable).toHaveLength(25);

      // Verify second batch has 12 items
      const secondBatchCall = ddbMock.call(2);
      expect(secondBatchCall.args[0].input.RequestItems.TestMemoryTable).toHaveLength(12);
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
      const deleteRequests = batchCall.args[0].input.RequestItems.TestMemoryTable;

      expect(deleteRequests).toEqual([
        { DeleteRequest: { Key: { userId: 'user123', timestamp: 1000 } } },
        { DeleteRequest: { Key: { userId: 'user123', timestamp: 2000 } } },
      ]);
    });
  });
});
