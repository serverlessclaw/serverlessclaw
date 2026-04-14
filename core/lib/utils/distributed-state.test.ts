import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DynamoDB
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {
    send = mockSend;
  },
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  },
  GetCommand: vi.fn().mockImplementation((args) => args),
  UpdateCommand: vi.fn().mockImplementation((args) => args),
}));

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { DistributedState } from './distributed-state';

describe('DistributedState', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('isCircuitOpen', () => {
    it('should return false if no state exists', async () => {
      mockSend.mockResolvedValue({ Item: undefined });
      const isOpen = await DistributedState.isCircuitOpen('test', 5, 60000);
      expect(isOpen).toBe(false);
    });

    it('should return true if count is above threshold and within timeout', async () => {
      mockSend.mockResolvedValue({
        Item: {
          count: 5,
          openedAt: Date.now() - 10000, // 10s ago
        },
      });
      const isOpen = await DistributedState.isCircuitOpen('test', 5, 60000);
      expect(isOpen).toBe(true);
    });

    it('should return false if count is above threshold but timeout elapsed', async () => {
      mockSend.mockResolvedValue({
        Item: {
          count: 5,
          openedAt: Date.now() - 70000, // 70s ago
        },
      });
      const isOpen = await DistributedState.isCircuitOpen('test', 5, 60000);
      expect(isOpen).toBe(false);
    });
  });

  describe('consumeToken', () => {
    it('should allow consuming a token and initialize bucket if not exists', async () => {
      // 1. Get fails (no item)
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // 2. Update (init) succeeds
      mockSend.mockResolvedValueOnce({});

      const allowed = await DistributedState.consumeToken('test-rate', 10, 1000);
      expect(allowed).toBe(true);
    });

    it('should allow consuming if tokens available in existing bucket', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          tokens: 5,
          lastRefill: Date.now(),
        },
      });
      mockSend.mockResolvedValueOnce({}); // Update succeeds

      const allowed = await DistributedState.consumeToken('test-rate', 10, 1000);
      expect(allowed).toBe(true);
    });

    it('should allow consuming if bucket refills over time', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          tokens: 0,
          lastRefill: Date.now() - 2000, // 2s ago, should refill 2 tokens if refillMs=1000 and capacity=10?
          // Interval = 1000/10 = 100ms. 2000ms = 20 tokens (capped at capacity 10).
        },
      });
      mockSend.mockResolvedValueOnce({}); // Update succeeds

      const allowed = await DistributedState.consumeToken('test-rate', 10, 1000);
      expect(allowed).toBe(true);
    });

    it('should block consuming if no tokens available and no refill', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          tokens: 0,
          lastRefill: Date.now() - 10, // 10ms ago, not enough for refill interval
        },
      });

      const allowed = await DistributedState.consumeToken('test-rate', 10, 1000);
      expect(allowed).toBe(false);
    });
  });
});
