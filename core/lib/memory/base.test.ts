import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
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
});
