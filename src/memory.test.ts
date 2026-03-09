import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoMemory, Message } from './memory';

// Mock Resource from sst
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: {
      name: 'mock-table',
    },
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DynamoMemory', () => {
  let memory: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    memory = new DynamoMemory();
  });

  describe('getHistory', () => {
    it('should return history from DynamoDB', async () => {
      const mockItems = [
        { role: 'user', content: 'hello', timestamp: 123 },
        { role: 'assistant', content: 'hi', timestamp: 124 },
      ];

      ddbMock.on(QueryCommand).resolves({
        Items: mockItems,
      });

      const history = await memory.getHistory('user-1');

      expect(history).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ]);
      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('should return empty array on overflow or error', async () => {
      ddbMock.on(QueryCommand).rejects(new Error('DynamoDB Error'));

      const history = await memory.getHistory('user-1');

      expect(history).toEqual([]);
    });

    it('should handle undefined Items from DynamoDB', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: undefined });

      const history = await memory.getHistory('user-1');

      expect(history).toEqual([]);
    });
  });

  describe('addMessage', () => {
    it('should call PutCommand with correct parameters', async () => {
      ddbMock.on(PutCommand).resolves({});

      const message: Message = { role: 'user', content: 'test message' };
      await memory.addMessage('user-1', message);

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toMatchObject({
        TableName: 'mock-table',
        Item: {
          userId: 'user-1',
          role: 'user',
          content: 'test message',
        },
      });
      expect(calls[0].args[0].input.Item?.timestamp).toBeDefined();
    });

    it('should handle errors gracefully during PutCommand', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      ddbMock.on(PutCommand).rejects(new Error('Put Error'));

      await memory.addMessage('user-1', { role: 'user', content: 'fails' });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error saving message to DynamoDB:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });
});
