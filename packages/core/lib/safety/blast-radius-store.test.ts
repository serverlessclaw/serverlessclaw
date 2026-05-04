/**
 * @module BlastRadiusStore Tests
 * @description Unit tests for DynamoDB-backed blast radius storage.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ Item: undefined }),
}));

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: {
      name: 'TestMemoryTable',
    },
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({
        send: mockSend,
      }),
    },
  };
});

import { BlastRadiusStore, getBlastRadiusStore, resetBlastRadiusStore } from './blast-radius-store';

describe('BlastRadiusStore', () => {
  let store: BlastRadiusStore;

  beforeEach(() => {
    vi.clearAllMocks();
    resetBlastRadiusStore();
    store = getBlastRadiusStore();
    store.clearLocalCache();
  });

  afterEach(() => {
    store.clearLocalCache();
  });

  describe('getBlastRadius', () => {
    it('should return null when no entry exists', async () => {
      const result = await store.getBlastRadius('agent-1', 'deployment');
      expect(result).toBeNull();
    });
  });

  describe('incrementBlastRadius', () => {
    it('should increment count on first call', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          count: 1,
          lastAction: Date.now(),
          resourceCount: 0,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });

      const result = await store.incrementBlastRadius('agent-1', 'deployment');
      expect(result.count).toBe(1);
      expect(result.lastAction).toBeGreaterThan(0);
    });

    it('should increment existing count', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          count: 1,
          lastAction: Date.now(),
          resourceCount: 0,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });
      await store.incrementBlastRadius('agent-1', 'deployment');

      mockSend.mockResolvedValueOnce({
        Attributes: {
          count: 2,
          lastAction: Date.now(),
          resourceCount: 0,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });
      const result = await store.incrementBlastRadius('agent-1', 'deployment');
      expect(result.count).toBe(2);
    });

    it('should track resource count when resource provided', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          count: 1,
          lastAction: Date.now(),
          resourceCount: 1,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });
      const result = await store.incrementBlastRadius('agent-1', 'deployment', 'some-resource');
      expect(result.resourceCount).toBe(1);
    });

    it('REPRO/FIX: should use atomic UpdateExpression with field-level ADD for sliding windows', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          count: 5,
          lastAction: Date.now(),
          resourceCount: 1,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });

      await store.incrementBlastRadius('agent-1', 'deployment', 'res-1');

      const lastCall = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
      const params = lastCall.input;

      // Verify schema compliance (native ADD for count and resourceCount)
      expect(params.UpdateExpression).toContain('#cnt :one');
      expect(params.UpdateExpression).toContain('resourceCount :resCnt');
      expect(params.ExpressionAttributeNames).toHaveProperty('#cnt', 'count');
    });

    it('should transition to Phase 2 (atomic reset) when window is expired', async () => {
      // 1. First call fails with ConditionalCheckFailedException (window expired)
      const conditionalError = new Error('ConditionalCheckFailed');
      conditionalError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(conditionalError);

      // 2. Second call (Phase 2 reset) succeeds
      const now = Date.now();
      mockSend.mockResolvedValueOnce({
        Attributes: {
          count: 1,
          lastAction: now,
          resourceCount: 1,
          expiresAt: Math.floor(now / 1000) + 3600,
        },
      });

      const result = await store.incrementBlastRadius('agent-1', 'deployment', 'res-1');

      expect(result.count).toBe(1);
      expect(mockSend).toHaveBeenCalledTimes(2);

      const resetCall = mockSend.mock.calls[1][0].input;
      expect(resetCall.UpdateExpression).toContain('SET #cnt = :one');
      expect(resetCall.ConditionExpression).toContain(
        'attribute_not_exists(userId) OR expiresAt <= :nowSec'
      );
    });

    it('should fail closed by throwing an error if Phase 2 atomic reset exceeds max retries', async () => {
      const conditionalError = new Error('ConditionalCheckFailed');
      conditionalError.name = 'ConditionalCheckFailedException';

      // Ensure all phase 1 and phase 2 calls fail
      mockSend.mockRejectedValue(conditionalError);

      await expect(store.incrementBlastRadius('agent-1', 'deployment', 'res-1')).rejects.toThrow(
        'BLAST_RADIUS_STORE_ERROR: Max retry count exceeded'
      );

      // 4 iterations (retry 0, 1, 2, 3). Each has Phase 1 + Phase 2 = 8 calls.
      expect(mockSend).toHaveBeenCalledTimes(8);

      // Restore default mock
      mockSend.mockResolvedValue({ Item: undefined });
    });
  });

  describe('checkLimit', () => {
    it('should return allowed when under limit', async () => {
      const result = await store.checkLimit('agent-1', 'deployment');
      expect(result.allowed).toBe(true);
    });

    it('should return not allowed when at limit', async () => {
      // Mock sequential increments: 1, 2, 3, 4, 5
      for (let i = 1; i <= 5; i++) {
        mockSend.mockResolvedValueOnce({
          Attributes: {
            count: i,
            lastAction: Date.now(),
            resourceCount: 0,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          },
        });
        await store.incrementBlastRadius('agent-1', 'deployment');
      }

      // getBlastRadius will return the cached count of 5
      const result = await store.checkLimit('agent-1', 'deployment');
      expect(result.allowed).toBe(false);
      expect(result.count).toBe(5);
    });
  });

  describe('canExecute', () => {
    it('should return allowed when under limit', async () => {
      const result = await store.canExecute('agent-1', 'deployment');
      expect(result.allowed).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return error when at limit', async () => {
      for (let i = 1; i <= 5; i++) {
        mockSend.mockResolvedValueOnce({
          Attributes: {
            count: i,
            lastAction: Date.now(),
            resourceCount: 0,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          },
        });
        await store.incrementBlastRadius('agent-1', 'deployment');
      }

      const result = await store.canExecute('agent-1', 'deployment');
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('BLAST_RADIUS_EXCEEDED');
      expect(result.error).toContain('5/5');
    });
  });

  describe('getLocalStats', () => {
    it('should return local cache stats', async () => {
      await store.incrementBlastRadius('agent-1', 'deployment');
      await store.incrementBlastRadius('agent-1', 'code_change');

      const stats = store.getLocalStats();
      expect(Object.keys(stats).length).toBe(2);
    });

    it('should return empty object when no entries', async () => {
      const stats = store.getLocalStats();
      expect(stats).toEqual({});
    });
  });

  describe('clearLocalCache', () => {
    it('should clear local cache', async () => {
      await store.incrementBlastRadius('agent-1', 'deployment');
      store.clearLocalCache();

      const stats = store.getLocalStats();
      expect(Object.keys(stats).length).toBe(0);
    });
  });

  describe('separate agent-action tracking', () => {
    it('should track each agent-action combination separately', async () => {
      await store.incrementBlastRadius('agent-1', 'deployment');
      await store.incrementBlastRadius('agent-2', 'deployment');
      await store.incrementBlastRadius('agent-1', 'code_change');

      const stats = store.getLocalStats();
      expect(Object.keys(stats).length).toBe(3);
    });
  });
});

describe('BlastRadiusStore Singleton', () => {
  afterEach(() => {
    resetBlastRadiusStore();
  });

  it('should return same instance', () => {
    const instance1 = getBlastRadiusStore();
    const instance2 = getBlastRadiusStore();
    expect(instance1).toBe(instance2);
  });

  it('should reset between test runs', () => {
    const instance1 = getBlastRadiusStore();
    resetBlastRadiusStore();
    const instance2 = getBlastRadiusStore();
    expect(instance1).not.toBe(instance2);
  });
});
