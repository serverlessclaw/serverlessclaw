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
      mockSend.mockResolvedValueOnce({
        Item: {
          count: 5,
          openedAt: Date.now() - 70000, // 70s ago
        },
      });
      // The second call is the reset operation
      mockSend.mockResolvedValueOnce({});

      const isOpen = await DistributedState.isCircuitOpen('test', 5, 60000);
      expect(isOpen).toBe(false);
      // Verify reset was called to clear count
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should reset count when circuit timeout expires', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          count: 10,
          openedAt: Date.now() - 70000, // timeout expired
        },
      });
      mockSend.mockResolvedValueOnce({}); // reset succeeds

      const isOpen = await DistributedState.isCircuitOpen('test', 5, 60000);
      expect(isOpen).toBe(false);
      // Verify reset was called - should have 2 calls (get + update)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should return true (Fail-Closed) if DynamoDB fails', async () => {
      mockSend.mockRejectedValue(new Error('DDB failure'));
      const isOpen = await DistributedState.isCircuitOpen('test', 5, 60000);
      expect(isOpen).toBe(true);
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
          lastRefill: Date.now() - 2000, // 2s ago
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
          lastRefill: Date.now() - 10, // 10ms ago
        },
      });

      const allowed = await DistributedState.consumeToken('test-rate', 10, 1000);
      expect(allowed).toBe(false);
    });

    it('should return false (Fail-Closed) if DynamoDB fails', async () => {
      mockSend.mockRejectedValue(new Error('DDB failure'));
      const allowed = await DistributedState.consumeToken('test-rate', 10, 1000);
      expect(allowed).toBe(false);
    });
  });
});
