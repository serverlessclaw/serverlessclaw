/**
 * Clarification Operations Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  saveClarificationRequest,
  getClarificationRequest,
  updateClarificationStatus,
  findExpiredClarifications,
  incrementClarificationRetry,
} from './clarification-operations';
import type { BaseMemoryProvider } from './base';
import { ClarificationStatus } from '../types/memory';

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('clarification-operations', () => {
  let mockBase: BaseMemoryProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBase = {
      putItem: vi.fn().mockResolvedValue(undefined),
      queryItems: vi.fn().mockResolvedValue([]),
      updateItem: vi.fn().mockResolvedValue({ retryCount: 2 }),
    } as unknown as BaseMemoryProvider;
  });

  describe('saveClarificationRequest', () => {
    it('should save clarification request with correct structure', async () => {
      const state = {
        traceId: 'trace-123',
        agentId: 'coder-agent',
        initiatorId: 'superclaw',
        question: 'What should I do?',
        originalTask: 'Fix the bug',
        userId: 'user123',
        depth: 1,
        sessionId: 'session-123',
        status: ClarificationStatus.PENDING,
        createdAt: Date.now(),
        retryCount: 0,
      };

      await saveClarificationRequest(mockBase, state);

      expect(mockBase.putItem).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: 'trace-123',
          agentId: 'coder-agent',
          type: 'CLARIFICATION_PENDING',
          timestamp: 0,
          createdAt: expect.any(Number),
        })
      );
    });

    it('should set expiresAt in the future', async () => {
      const state = {
        traceId: 'trace-123',
        agentId: 'coder-agent',
        initiatorId: 'superclaw',
        question: 'Test',
        originalTask: 'Task',
        userId: 'user123',
        depth: 1,
        status: ClarificationStatus.PENDING,
        createdAt: Date.now(),
        retryCount: 0,
      };

      await saveClarificationRequest(mockBase, state);

      const call = (mockBase.putItem as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  describe('getClarificationRequest', () => {
    it('should return clarification state when found', async () => {
      const mockState = {
        userId: 'CLARIFICATION#trace-123#coder-agent',
        traceId: 'trace-123',
        agentId: 'coder-agent',
        status: 'pending',
      };
      mockBase.queryItems = vi.fn().mockResolvedValue([mockState]);

      const result = await getClarificationRequest(mockBase, 'trace-123', 'coder-agent');

      expect(result).toEqual(mockState);
      expect(mockBase.queryItems).toHaveBeenCalledWith(
        expect.objectContaining({
          KeyConditionExpression: 'userId = :pk',
          Limit: 1,
        })
      );
    });

    it('should return null when not found', async () => {
      mockBase.queryItems = vi.fn().mockResolvedValue([]);

      const result = await getClarificationRequest(mockBase, 'trace-missing', 'agent');

      expect(result).toBeNull();
    });
  });

  describe('updateClarificationStatus', () => {
    it('should update status correctly', async () => {
      await updateClarificationStatus(
        mockBase,
        'trace-123',
        'coder-agent',
        ClarificationStatus.ANSWERED
      );

      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { userId: 'CLARIFICATION#trace-123#coder-agent', timestamp: 0 },
          UpdateExpression: 'SET #status = :status',
          ExpressionAttributeValues: expect.objectContaining({
            ':status': ClarificationStatus.ANSWERED,
          }),
        })
      );
    });
  });

  describe('findExpiredClarifications', () => {
    it('should find expired pending clarifications', async () => {
      const expiredItems = [
        { traceId: 'trace-1', agentId: 'agent-1', status: 'pending', expiresAt: 1000 },
      ];
      mockBase.queryItems = vi.fn().mockResolvedValue(expiredItems);

      const result = await findExpiredClarifications(mockBase);

      expect(result).toEqual(expiredItems);
      expect(mockBase.queryItems).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: 'TypeTimestampIndex',
          KeyConditionExpression: '#tp = :type',
          FilterExpression: expect.stringContaining('expiresAt'),
        })
      );
    });

    it('should return empty array when no expired clarifications', async () => {
      mockBase.queryItems = vi.fn().mockResolvedValue([]);

      const result = await findExpiredClarifications(mockBase);

      expect(result).toEqual([]);
    });
  });

  describe('incrementClarificationRetry', () => {
    it('should increment and return new retry count', async () => {
      mockBase.updateItem = vi.fn().mockResolvedValue({ retryCount: 3 });

      const result = await incrementClarificationRetry(mockBase, 'trace-123', 'coder-agent');

      expect(result).toBe(3);
      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { userId: 'CLARIFICATION#trace-123#coder-agent', timestamp: 0 },
          UpdateExpression: 'SET retryCount = retryCount + :one',
          ReturnValues: 'ALL_NEW',
        })
      );
    });

    it('should return 0 when retryCount is missing', async () => {
      mockBase.updateItem = vi.fn().mockResolvedValue({});

      const result = await incrementClarificationRetry(mockBase, 'trace-123', 'coder-agent');

      expect(result).toBe(0);
    });
  });
});
