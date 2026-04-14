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
    ConfigTable: {
      name: 'TestTable',
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
          value: {
            count: 1,
            lastAction: Date.now(),
            resourceCount: 0,
            expiresAt: Date.now() + 3600000,
          },
        },
      });

      const result = await store.incrementBlastRadius('agent-1', 'deployment');
      expect(result.count).toBe(1);
      expect(result.lastAction).toBeGreaterThan(0);
    });

    it('should increment existing count', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          value: {
            count: 1,
            lastAction: Date.now(),
            resourceCount: 0,
            expiresAt: Date.now() + 3600000,
          },
        },
      });
      await store.incrementBlastRadius('agent-1', 'deployment');

      mockSend.mockResolvedValueOnce({
        Attributes: {
          value: {
            count: 2,
            lastAction: Date.now(),
            resourceCount: 0,
            expiresAt: Date.now() + 3600000,
          },
        },
      });
      const result = await store.incrementBlastRadius('agent-1', 'deployment');
      expect(result.count).toBe(2);
    });

    it('should track resource count when resource provided', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          value: {
            count: 1,
            lastAction: Date.now(),
            resourceCount: 1,
            expiresAt: Date.now() + 3600000,
          },
        },
      });
      const result = await store.incrementBlastRadius('agent-1', 'deployment', 'some-resource');
      expect(result.resourceCount).toBe(1);
    });

    it('REPRO/FIX: should use atomic UpdateCommand with value wrapper for schema compliance', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          value: {
            count: 5,
            lastAction: Date.now(),
            resourceCount: 1,
            expiresAt: Date.now() + 3600000,
          },
        },
      });

      await store.incrementBlastRadius('agent-1', 'deployment', 'res-1');

      const lastCall = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
      const params = lastCall.input;

      // Verify schema compliance
      expect(params.UpdateExpression).toContain('#val.#cnt');
      expect(params.UpdateExpression).toContain('#val.#rcnt');
      expect(params.ExpressionAttributeNames).toHaveProperty('#val', 'value');
      expect(params.ExpressionAttributeNames).toHaveProperty('#cnt', 'count');
    });
  });

  describe('checkLimit', () => {
    it('should return allowed when under limit', async () => {
      const result = await store.checkLimit('agent-1', 'deployment');
      expect(result.allowed).toBe(true);
    });

    it('should return not allowed when at limit', async () => {
      await store.incrementBlastRadius('agent-1', 'deployment');
      await store.incrementBlastRadius('agent-1', 'deployment');
      await store.incrementBlastRadius('agent-1', 'deployment');
      await store.incrementBlastRadius('agent-1', 'deployment');
      await store.incrementBlastRadius('agent-1', 'deployment');

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
      await store.incrementBlastRadius('agent-1', 'deployment');
      await store.incrementBlastRadius('agent-1', 'deployment');
      await store.incrementBlastRadius('agent-1', 'deployment');
      await store.incrementBlastRadius('agent-1', 'deployment');
      await store.incrementBlastRadius('agent-1', 'deployment');

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
