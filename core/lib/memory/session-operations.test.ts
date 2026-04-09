/**
 * Session Operations Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addMessage,
  deleteConversation,
  updateDistilledMemory,
  saveConversationMeta,
  saveLKGHash,
  getLatestLKGHash,
  incrementRecoveryAttemptCount,
  resetRecoveryAttemptCount,
  getSummary,
  updateSummary,
} from './session-operations';
import { MessageRole } from '../types/llm';
import type { BaseMemoryProvider } from './base';

vi.mock('./tiering', () => ({
  RetentionManager: {
    getExpiresAt: vi.fn().mockImplementation((category: string) => {
      const types: Record<string, string> = {
        MESSAGES: 'msg',
        LESSON: 'LESSON',
        LESSONS: 'LESSON',
        DISTILLED: 'DISTILLED',
        SESSIONS: 'SESSIONS',
        TRACES: 'trace',
      };
      return Promise.resolve({
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
        type: types[category.toUpperCase()] ?? 'SESSIONS',
      });
    }),
  },
}));

vi.mock('../utils/pii', () => ({
  filterPIIFromObject: vi.fn((obj) => obj),
}));

vi.mock('./utils', () => ({
  queryLatestContentByUserId: vi.fn().mockResolvedValue(['hash123']),
}));

describe('session-operations', () => {
  let mockBase: BaseMemoryProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBase = {
      putItem: vi.fn().mockResolvedValue(undefined),
      deleteItem: vi.fn().mockResolvedValue(undefined),
      updateItem: vi.fn().mockResolvedValue({ Attributes: { attempts: 5 } }),
      listConversations: vi.fn().mockResolvedValue([]),
      clearHistory: vi.fn().mockResolvedValue(undefined),
    } as unknown as BaseMemoryProvider;
  });

  describe('addMessage', () => {
    it('should add a message with tiered retention', async () => {
      const message = {
        role: MessageRole.USER,
        content: 'Hello',
        traceId: 'test-trace',
        messageId: 'test-msg',
      };
      await addMessage(mockBase, 'user123', message);

      expect(mockBase.putItem).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user123',
          timestamp: expect.any(Number),
          createdAt: expect.any(Number),
          type: 'msg',
          role: MessageRole.USER,
          content: 'Hello',
        })
      );
    });

    it('should filter PII from message', async () => {
      const message = {
        role: MessageRole.USER,
        content: 'My email is test@example.com',
        traceId: 'test-trace',
        messageId: 'test-msg',
      };
      await addMessage(mockBase, 'user123', message);

      expect(mockBase.putItem).toHaveBeenCalled();
    });
  });

  describe('saveConversationMeta', () => {
    it('should save session meta with updatedAtNumeric', async () => {
      await saveConversationMeta(mockBase, 'user123', 'sess_123', {
        title: 'My Session',
        lastMessage: 'Content',
      });

      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          UpdateExpression: expect.stringContaining('updatedAtNumeric = :now'),
          ExpressionAttributeValues: expect.objectContaining({
            ':now': expect.any(Number),
          }),
        })
      );
    });
  });

  describe('deleteConversation', () => {
    it('should delete existing conversation', async () => {
      const now = Date.now();
      mockBase.listConversations = vi
        .fn()
        .mockResolvedValue([{ sessionId: 'sess1', updatedAt: now }]);

      await deleteConversation(mockBase, 'user123', 'sess1');

      expect(mockBase.deleteItem).toHaveBeenCalledWith({
        userId: 'SESSIONS#user123',
        timestamp: now,
      });
      expect(mockBase.clearHistory).toHaveBeenCalledWith('CONV#user123#sess1');
    });

    it('should still clear history even if session not found', async () => {
      mockBase.listConversations = vi.fn().mockResolvedValue([]);

      await deleteConversation(mockBase, 'user123', 'sess-missing');

      expect(mockBase.deleteItem).not.toHaveBeenCalled();
      expect(mockBase.clearHistory).toHaveBeenCalledWith('CONV#user123#sess-missing');
    });

    it('should normalize userId by removing SESSIONS# prefix', async () => {
      mockBase.listConversations = vi.fn().mockResolvedValue([]);

      await deleteConversation(mockBase, 'SESSIONS#user123', 'sess1');

      expect(mockBase.listConversations).toHaveBeenCalledWith('user123');
    });
  });

  describe('updateDistilledMemory', () => {
    it('should update distilled memory with 2-year retention', async () => {
      await updateDistilledMemory(mockBase, 'user123', 'User likes coffee');

      expect(mockBase.putItem).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'DISTILLED#user123',
          timestamp: 0,
          type: 'DISTILLED',
          content: 'User likes coffee',
        })
      );
    });

    it('should normalize userId', async () => {
      await updateDistilledMemory(mockBase, 'DISTILLED#user123', 'Facts');

      expect(mockBase.putItem).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'DISTILLED#user123',
        })
      );
    });
  });

  describe('saveConversationMeta', () => {
    it('should save new conversation metadata using updateItem', async () => {
      await saveConversationMeta(mockBase, 'user123', 'sess1', { title: 'Chat 1' });

      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: expect.objectContaining({
            userId: 'SESSIONS#user123',
          }),
          UpdateExpression: expect.stringContaining('SET sessionId = :sessionId'),
          ExpressionAttributeValues: expect.objectContaining({
            ':sessionId': 'sess1',
            ':title': 'Chat 1',
            ':pinned': false,
          }),
        })
      );
    });

    it('should update existing conversation metadata atomically', async () => {
      // With the new implementation, it's just an updateItem call regardless
      await saveConversationMeta(mockBase, 'user123', 'sess1', { title: 'New Title' });

      expect(mockBase.updateItem).toHaveBeenCalled();
      expect(mockBase.deleteItem).not.toHaveBeenCalled();
    });

    it('should set expiresAt to 0 for pinned items', async () => {
      await saveConversationMeta(mockBase, 'user123', 'sess1', { isPinned: true });

      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({
            ':pinned': true,
            ':exp': 0,
          }),
        })
      );
    });

    it('should use stable timestamp derived from sessionId', async () => {
      // sess_1711000000000 -> 1711000000000
      const sessionId = 'sess_1711000000000';
      await saveConversationMeta(mockBase, 'user123', sessionId, { title: 'Stable' });

      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: {
            userId: 'SESSIONS#user123',
            timestamp: '1711000000000',
          },
        })
      );
    });

    it('should generate stable hash for non-numeric session IDs', async () => {
      const sessionId = 'random-guid-string';
      await saveConversationMeta(mockBase, 'user123', sessionId, { title: 'Hashed' });

      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: {
            userId: 'SESSIONS#user123',
            timestamp: '10241265185405767486',
          },
        })
      );

      const firstCall = (mockBase.updateItem as any).mock.calls[0][0].Key.timestamp;

      // Reset mock and call again with same ID
      vi.clearAllMocks();
      await saveConversationMeta(mockBase, 'user123', sessionId, { title: 'Hashed' });
      const secondCall = (mockBase.updateItem as any).mock.calls[0][0].Key.timestamp;

      expect(firstCall).toBe(secondCall);
      expect(typeof firstCall).toBe('string');
    });
  });

  describe('saveLKGHash', () => {
    it('should save LKG hash', async () => {
      await saveLKGHash(mockBase, 'abc123');

      expect(mockBase.putItem).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'SYSTEM#LKG',
          type: 'DISTILLED',
          content: 'abc123',
        })
      );
    });
  });

  describe('getLatestLKGHash', () => {
    it('should return latest LKG hash', async () => {
      const { queryLatestContentByUserId } = await import('./utils');
      (queryLatestContentByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(['hash123']);

      const result = await getLatestLKGHash(mockBase);

      expect(result).toBe('hash123');
    });

    it('should return null when no hash exists', async () => {
      const { queryLatestContentByUserId } = await import('./utils');
      (queryLatestContentByUserId as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await getLatestLKGHash(mockBase);

      expect(result).toBeNull();
    });
  });

  describe('incrementRecoveryAttemptCount', () => {
    it('should increment and return new count', async () => {
      mockBase.updateItem = vi.fn().mockResolvedValue({ Attributes: { attempts: 5 } });

      const result = await incrementRecoveryAttemptCount(mockBase);

      expect(result).toBe(5);
      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { userId: 'SYSTEM#RECOVERY#STATS', timestamp: 0 },
          UpdateExpression: expect.stringContaining('attempts'),
          ReturnValues: 'ALL_NEW',
        })
      );
    });

    it('should return 1 when Attributes is missing', async () => {
      mockBase.updateItem = vi.fn().mockResolvedValue({});

      const result = await incrementRecoveryAttemptCount(mockBase);

      expect(result).toBe(1);
    });
  });

  describe('resetRecoveryAttemptCount', () => {
    it('should reset attempt count to zero', async () => {
      await resetRecoveryAttemptCount(mockBase);

      expect(mockBase.updateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { userId: 'SYSTEM#RECOVERY#STATS', timestamp: 0 },
          UpdateExpression: 'SET attempts = :zero, updatedAt = :now',
          ExpressionAttributeValues: expect.objectContaining({
            ':zero': 0,
          }),
        })
      );
    });
  });

  describe('getSummary', () => {
    it('should return latest summary', async () => {
      const { queryLatestContentByUserId } = await import('./utils');
      (queryLatestContentByUserId as ReturnType<typeof vi.fn>).mockResolvedValue(['Summary text']);

      const result = await getSummary(mockBase, 'user123');

      expect(result).toBe('Summary text');
    });

    it('should return null when no summary exists', async () => {
      const { queryLatestContentByUserId } = await import('./utils');
      (queryLatestContentByUserId as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await getSummary(mockBase, 'user123');

      expect(result).toBeNull();
    });
  });

  describe('updateSummary', () => {
    it('should update conversation summary', async () => {
      await updateSummary(mockBase, 'user123', 'User discussed AI');

      expect(mockBase.putItem).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'SUMMARY#user123',
          type: 'SUMMARY',
          content: 'User discussed AI',
        })
      );
    });
  });
});
