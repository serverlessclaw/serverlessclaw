import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDeployCountToday, incrementDeployCount, rewardDeployLimit } from './deploy-stats';

const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
  },
}));

describe('deploy-stats utility', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  describe('getDeployCountToday', () => {
    it('should return count if lastReset matches today', async () => {
      const today = new Date().toISOString().split('T')[0];
      ddbMock.on(GetCommand).resolves({
        Item: { count: 5, lastReset: today },
      });

      const count = await getDeployCountToday();
      expect(count).toBe(5);
    });

    it('should return 0 if lastReset does not match today', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { count: 5, lastReset: '2000-01-01' },
      });

      const count = await getDeployCountToday();
      expect(count).toBe(0);
    });

    it('should return 0 if no item is found', async () => {
      ddbMock.on(GetCommand).resolves({});

      const count = await getDeployCountToday();
      expect(count).toBe(0);
    });
  });

  describe('incrementDeployCount', () => {
    it('should send UpdateCommand to increment count with atomic condition', async () => {
      const today = new Date().toISOString().split('T')[0];
      ddbMock.on(UpdateCommand).resolves({});

      const result = await incrementDeployCount(today, 5);

      expect(result).toBe(true);
      expect(ddbMock.calls()).toHaveLength(1);
      const call = ddbMock.call(0);
      expect(call.args[0].input).toMatchObject({
        TableName: 'test-memory-table',
        UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one, lastReset = :today',
        ConditionExpression: '#count < :limit',
      });
    });

    it('should return false when limit is reached (condition fails)', async () => {
      const today = new Date().toISOString().split('T')[0];
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      const result = await incrementDeployCount(today, 5);

      expect(result).toBe(false);
    });
  });

  describe('rewardDeployLimit', () => {
    it('should use a floored conditional decrement (ConditionExpression: count > 0)', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await rewardDeployLimit();

      expect(ddbMock.calls()).toHaveLength(1);
      const call = ddbMock.call(0);
      expect(call.args[0].input).toMatchObject({
        TableName: 'test-memory-table',
        UpdateExpression: 'SET #count = #count - :one',
        ConditionExpression: '#count > :zero',
      });
    });

    it('should NOT throw when count is already 0 (ConditionalCheckFailedException swallowed)', async () => {
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      // Must resolve without throwing — floor is enforced, no negative counts
      await expect(rewardDeployLimit()).resolves.toBeUndefined();
    });

    it('should re-throw non-condition errors', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('Network failure'));

      await expect(rewardDeployLimit()).rejects.toThrow('Network failure');
    });
  });
});
