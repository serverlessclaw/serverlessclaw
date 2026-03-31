import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

// Mock sst Resource
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

// Mock docClient
const ddbMock = mockClient(DynamoDBDocumentClient);

import { DynamoMemory } from './dynamo-memory';

describe('DynamoMemory Regression Tests', () => {
  let memory: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    memory = new DynamoMemory();
    vi.clearAllMocks();
  });

  describe('LKG (Last Known Good) Logic', () => {
    it('should save LKG hash with correct partition and sort key', async () => {
      ddbMock.on(PutCommand).resolves({});

      const testHash = 'abc12345';
      await memory.saveLKGHash(testHash);

      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls).toHaveLength(1);
      const item = putCalls[0].args[0].input.Item;
      expect(item?.userId).toBe('SYSTEM#LKG');
      expect(item?.content).toBe(testHash);
      expect(item?.type).toBe('msg');
    });

    it('should retrieve the latest LKG hash via Query', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'SYSTEM#LKG', content: 'latest-hash' }],
      });

      const hash = await memory.getLatestLKGHash();
      expect(hash).toBe('latest-hash');

      const queryCalls = ddbMock.commandCalls(QueryCommand);
      expect(queryCalls[0].args[0].input.ExpressionAttributeValues?.[':userId']).toBe('SYSTEM#LKG');
      expect(queryCalls[0].args[0].input.ScanIndexForward).toBe(false);
    });

    it('should return null if no LKG hash exists', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      const hash = await memory.getLatestLKGHash();
      expect(hash).toBeNull();
    });
  });

  describe('Recovery Stats Logic', () => {
    it('should atomically increment attempt count', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { attempts: 5 },
      });

      const count = await memory.incrementRecoveryAttemptCount();
      expect(count).toBe(5);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const input = updateCalls[0].args[0].input;
      expect(input.Key?.userId).toBe('SYSTEM#RECOVERY#STATS');
      expect(input.UpdateExpression).toContain(
        'SET attempts = if_not_exists(attempts, :zero) + :one'
      );
    });

    it('should reset attempt count to zero', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await memory.resetRecoveryAttemptCount();

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const input = updateCalls[0].args[0].input;
      expect(input.UpdateExpression).toContain('SET attempts = :zero');
      expect(input.ExpressionAttributeValues?.[':zero']).toBe(0);
    });
  });
});
