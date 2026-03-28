import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoLockManager } from './lock';

const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

describe('DynamoLockManager', () => {
  let lockManager: DynamoLockManager;

  beforeEach(() => {
    ddbMock.reset();
    lockManager = new DynamoLockManager();
  });

  describe('acquire', () => {
    it('should return true if lock is acquired successfully', async () => {
      ddbMock.on(PutCommand).resolves({});

      const result = await lockManager.acquire('test-lock', 'owner-123', 30);
      expect(result).toBe(true);
      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('should return false if conditional check fails', async () => {
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejects(error);

      const result = await lockManager.acquire('test-lock', 'owner-123', 30);
      expect(result).toBe(false);
    });

    it('should throw error if DDB operation fails for other reasons', async () => {
      ddbMock.on(PutCommand).rejects(new Error('Network error'));

      await expect(lockManager.acquire('test-lock', 'owner-123')).rejects.toThrow('Network error');
    });
  });

  describe('release', () => {
    it('should send DeleteCommand to release lock', async () => {
      ddbMock.on(DeleteCommand).resolves({});

      await lockManager.release('test-lock', 'owner-123');

      expect(ddbMock.calls()).toHaveLength(1);
      const call = ddbMock.call(0);
      expect(call.args[0].input).toMatchObject({
        TableName: 'test-memory-table',
        Key: { userId: 'LOCK#test-lock', timestamp: 0 },
      });
    });
  });
});
