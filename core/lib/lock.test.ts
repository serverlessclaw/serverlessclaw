import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoLockManager } from './lock';

const ddbMock = mockClient(DynamoDBDocumentClient);

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

    it('should use LOCK# prefix for key', async () => {
      ddbMock.on(PutCommand).resolves({});

      await lockManager.acquire('my-lock', 'owner-1', 60);

      const call = ddbMock.call(0);
      const input = call.args[0].input as Record<string, unknown>;
      expect((input.Item as Record<string, unknown>).userId).toBe('LOCK#my-lock');
    });

    it('should set timestamp to 0', async () => {
      ddbMock.on(PutCommand).resolves({});

      await lockManager.acquire('my-lock', 'owner-1', 60);

      const call = ddbMock.call(0);
      const input = call.args[0].input as Record<string, unknown>;
      expect((input.Item as Record<string, unknown>).timestamp).toBe(0);
    });

    it('should include ownerId in the item', async () => {
      ddbMock.on(PutCommand).resolves({});

      await lockManager.acquire('my-lock', 'specific-owner', 60);

      const call = ddbMock.call(0);
      const input = call.args[0].input as Record<string, unknown>;
      expect((input.Item as Record<string, unknown>).ownerId).toBe('specific-owner');
    });

    it('should set acquiredAt timestamp', async () => {
      const before = Date.now();
      ddbMock.on(PutCommand).resolves({});

      await lockManager.acquire('my-lock', 'owner-1', 60);

      const call = ddbMock.call(0);
      const input = call.args[0].input as Record<string, unknown>;
      const after = Date.now();
      expect((input.Item as Record<string, unknown>).acquiredAt).toBeGreaterThanOrEqual(before);
      expect((input.Item as Record<string, unknown>).acquiredAt).toBeLessThanOrEqual(after);
    });

    it('should use default TTL from constants if not specified', async () => {
      ddbMock.on(PutCommand).resolves({});

      await lockManager.acquire('my-lock', 'owner-1');

      const call = ddbMock.call(0);
      const input = call.args[0].input as Record<string, unknown>;
      expect((input.Item as Record<string, unknown>).expiresAt).toBeGreaterThan(0);
    });

    it('should set condition expression', async () => {
      ddbMock.on(PutCommand).resolves({});

      await lockManager.acquire('my-lock', 'owner-1', 30);

      const call = ddbMock.call(0);
      const input = call.args[0].input as Record<string, unknown>;
      expect(input.ConditionExpression).toContain('attribute_not_exists');
      expect(input.ConditionExpression).toContain('expiresAt');
    });

    it('should set expression attribute values for :now', async () => {
      ddbMock.on(PutCommand).resolves({});

      await lockManager.acquire('my-lock', 'owner-1', 30);

      const call = ddbMock.call(0);
      const input = call.args[0].input as Record<string, unknown>;
      expect((input.ExpressionAttributeValues as Record<string, unknown>)[':now']).toBeGreaterThan(
        0
      );
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

    it('should include ownerId condition', async () => {
      ddbMock.on(DeleteCommand).resolves({});

      await lockManager.release('test-lock', 'owner-123');

      const call = ddbMock.call(0);
      const input = call.args[0].input as Record<string, unknown>;
      expect(input.ConditionExpression).toBe('ownerId = :ownerId');
      expect((input.ExpressionAttributeValues as Record<string, unknown>)[':ownerId']).toBe(
        'owner-123'
      );
    });

    it('should handle ConditionalCheckFailedException gracefully', async () => {
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(DeleteCommand).rejects(error);

      await expect(lockManager.release('test-lock', 'wrong-owner')).resolves.not.toThrow();
    });

    it('should log on conditional check failure', async () => {
      const { logger } = await import('./logger');
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(DeleteCommand).rejects(error);

      await lockManager.release('test-lock', 'wrong-owner');

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Lock release failed'));
    });

    it('should log error for non-conditional failures', async () => {
      const { logger } = await import('./logger');
      ddbMock.on(DeleteCommand).rejects(new Error('Network error'));

      await lockManager.release('test-lock', 'owner-1');

      expect(logger.error).toHaveBeenCalledWith('Error releasing lock:', expect.any(Error));
    });
  });

  describe('renew', () => {
    it('should return true when renewal succeeds', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const result = await lockManager.renew('test-lock', 'owner-123', 60);
      expect(result).toBe(true);
    });

    it('should return false on ConditionalCheckFailedException', async () => {
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      const result = await lockManager.renew('test-lock', 'wrong-owner', 60);
      expect(result).toBe(false);
    });

    it('should throw on non-conditional errors', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('Network error'));

      await expect(lockManager.renew('test-lock', 'owner-1', 60)).rejects.toThrow('Network error');
    });

    it('should update expiresAt with new TTL', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await lockManager.renew('test-lock', 'owner-1', 120);

      const call = ddbMock.call(0);
      const input = call.args[0].input as Record<string, unknown>;
      expect(input.UpdateExpression).toContain('expiresAt');
      expect(
        (input.ExpressionAttributeValues as Record<string, unknown>)[':newExpires']
      ).toBeGreaterThan(0);
    });

    it('should set renewedAt timestamp', async () => {
      const before = Date.now();
      ddbMock.on(UpdateCommand).resolves({});

      await lockManager.renew('test-lock', 'owner-1', 60);

      const call = ddbMock.call(0);
      const input = call.args[0].input as Record<string, unknown>;
      const after = Date.now();
      expect(
        (input.ExpressionAttributeValues as Record<string, unknown>)[':renewedAt']
      ).toBeGreaterThanOrEqual(before);
      expect(
        (input.ExpressionAttributeValues as Record<string, unknown>)[':renewedAt']
      ).toBeLessThanOrEqual(after);
    });

    it('should check owner in condition expression', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await lockManager.renew('test-lock', 'owner-1', 60);

      const call = ddbMock.call(0);
      const input = call.args[0].input as Record<string, unknown>;
      expect(input.ConditionExpression).toContain('ownerId');
      expect(input.ConditionExpression).toContain('attribute_exists');
    });

    it('should log on conditional check failure', async () => {
      const { logger } = await import('./logger');
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(error);

      await lockManager.renew('test-lock', 'wrong-owner', 60);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Lock renewal failed'));
    });
  });

  describe('constructor injection', () => {
    it('should accept custom docClient', async () => {
      const customClient = DynamoDBDocumentClient.from(
        new (await import('@aws-sdk/client-dynamodb')).DynamoDBClient({})
      );
      const customManager = new DynamoLockManager(customClient);

      ddbMock.on(PutCommand).resolves({});
      const result = await customManager.acquire('lock-1', 'owner-1', 30);
      expect(result).toBe(true);
    });
  });
});
