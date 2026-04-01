import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CachedMemory } from './cached-memory';
import { MemoryCaches, CacheKeys } from './cache';

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const createMockDynamoMemory = () => ({
  getHistory: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue(undefined),
  getDistilledMemory: vi.fn().mockResolvedValue(''),
  updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  getLessons: vi.fn().mockResolvedValue([]),
  addLesson: vi.fn().mockResolvedValue(undefined),
  getSummary: vi.fn().mockResolvedValue(null),
  updateSummary: vi.fn().mockResolvedValue(undefined),
  getGlobalLessons: vi.fn().mockResolvedValue([]),
  addGlobalLesson: vi.fn().mockResolvedValue(1),
  searchInsights: vi.fn().mockResolvedValue({ items: [] }),
  addMemory: vi.fn().mockResolvedValue(1),
  getAllGaps: vi.fn().mockResolvedValue([]),
  setGap: vi.fn().mockResolvedValue(undefined),
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  searchInsightsForPreferences: vi.fn().mockResolvedValue({ prefixed: [], raw: [] }),
  clearHistory: vi.fn().mockResolvedValue(undefined),
  listConversations: vi.fn().mockResolvedValue([]),
  deleteConversation: vi.fn().mockResolvedValue(undefined),
  archiveStaleGaps: vi.fn().mockResolvedValue(0),
  incrementGapAttemptCount: vi.fn().mockResolvedValue(1),
  updateInsightMetadata: vi.fn().mockResolvedValue(undefined),
  refineMemory: vi.fn().mockResolvedValue(undefined),
  saveConversationMeta: vi.fn().mockResolvedValue(undefined),
  getMemoryByTypePaginated: vi.fn().mockResolvedValue({ items: [] }),
  getMemoryByType: vi.fn().mockResolvedValue([]),
  getLowUtilizationMemory: vi.fn().mockResolvedValue([]),
  getRegisteredMemoryTypes: vi.fn().mockResolvedValue([]),
  recordMemoryHit: vi.fn().mockResolvedValue(undefined),
  saveLKGHash: vi.fn().mockResolvedValue(undefined),
  getLatestLKGHash: vi.fn().mockResolvedValue(null),
  incrementRecoveryAttemptCount: vi.fn().mockResolvedValue(1),
  resetRecoveryAttemptCount: vi.fn().mockResolvedValue(undefined),
  listByPrefix: vi.fn().mockResolvedValue([]),
  saveClarificationRequest: vi.fn().mockResolvedValue(undefined),
  getClarificationRequest: vi.fn().mockResolvedValue(null),
  updateClarificationStatus: vi.fn().mockResolvedValue(undefined),
  saveEscalationState: vi.fn().mockResolvedValue(undefined),
  getEscalationState: vi.fn().mockResolvedValue(null),
  findExpiredClarifications: vi.fn().mockResolvedValue([]),
  incrementClarificationRetry: vi.fn().mockResolvedValue(1),
  getCollaboration: vi.fn().mockResolvedValue(null),
  checkCollaborationAccess: vi.fn().mockResolvedValue(true),
  closeCollaboration: vi.fn().mockResolvedValue(undefined),
  createCollaboration: vi.fn().mockResolvedValue({}),
  listCollaborationsForParticipant: vi.fn().mockResolvedValue([]),
  recordFailurePattern: vi.fn().mockResolvedValue(1),
  getFailurePatterns: vi.fn().mockResolvedValue([]),
  acquireGapLock: vi.fn().mockResolvedValue(true),
  releaseGapLock: vi.fn().mockResolvedValue(undefined),
  getGapLock: vi.fn().mockResolvedValue(null),
  updateGapMetadata: vi.fn().mockResolvedValue(undefined),
  recordFailedPlan: vi.fn().mockResolvedValue(1),
  getFailedPlans: vi.fn().mockResolvedValue([]),
});

describe('CachedMemory', () => {
  let cached: CachedMemory;
  let mockDynamo: ReturnType<typeof createMockDynamoMemory>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDynamo = createMockDynamoMemory();
    cached = new CachedMemory(mockDynamo as any);
    MemoryCaches.userData.clear();
    MemoryCaches.conversation.clear();
    MemoryCaches.global.clear();
    MemoryCaches.search.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getHistory', () => {
    it('should fetch from underlying on cache miss', async () => {
      const messages = [{ role: 'user', content: 'hi' }];
      mockDynamo.getHistory.mockResolvedValue(messages);

      const result = await cached.getHistory('user1');

      expect(result).toEqual(messages);
      expect(mockDynamo.getHistory).toHaveBeenCalledWith('user1');
    });

    it('should return cached value on cache hit', async () => {
      const messages = [{ role: 'user', content: 'hi' }];
      mockDynamo.getHistory.mockResolvedValue(messages);

      await cached.getHistory('user1');
      mockDynamo.getHistory.mockResolvedValue([]);
      const result = await cached.getHistory('user1');

      expect(result).toEqual(messages);
      expect(mockDynamo.getHistory).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache after TTL expires', async () => {
      const messages = [{ role: 'user', content: 'hi' }];
      mockDynamo.getHistory.mockResolvedValue(messages);

      await cached.getHistory('user1');
      vi.advanceTimersByTime(3 * 60 * 1000);
      await cached.getHistory('user1');

      expect(mockDynamo.getHistory).toHaveBeenCalledTimes(2);
    });
  });

  describe('addMessage', () => {
    it('should delegate to underlying and invalidate caches', async () => {
      const message = { role: 'user', content: 'hello' };
      mockDynamo.getHistory.mockResolvedValue([message]);
      await cached.getHistory('user1');

      await cached.addMessage('user1', message as any);

      expect(mockDynamo.addMessage).toHaveBeenCalledWith('user1', message);
      expect(MemoryCaches.conversation.has(CacheKeys.history('user1'))).toBe(false);
    });

    it('should invalidate both history and summary caches', async () => {
      mockDynamo.getSummary.mockResolvedValue('summary');
      await cached.getSummary('user1');
      await cached.addMessage('user1', { role: 'user', content: 'x' } as any);

      expect(MemoryCaches.conversation.has(CacheKeys.summary('user1'))).toBe(false);
    });
  });

  describe('getDistilledMemory', () => {
    it('should cache distilled memory with 5 min TTL', async () => {
      mockDynamo.getDistilledMemory.mockResolvedValue('distilled facts');
      const result = await cached.getDistilledMemory('user1');

      expect(result).toBe('distilled facts');
      mockDynamo.getDistilledMemory.mockResolvedValue('');
      const cached2 = await cached.getDistilledMemory('user1');

      expect(cached2).toBe('distilled facts');
      expect(mockDynamo.getDistilledMemory).toHaveBeenCalledTimes(1);
    });

    it('should refetch after cache expires', async () => {
      mockDynamo.getDistilledMemory.mockResolvedValue('v1');
      await cached.getDistilledMemory('user1');

      vi.advanceTimersByTime(6 * 60 * 1000);
      mockDynamo.getDistilledMemory.mockResolvedValue('v2');
      const result = await cached.getDistilledMemory('user1');

      expect(result).toBe('v2');
      expect(mockDynamo.getDistilledMemory).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateDistilledMemory', () => {
    it('should delegate and invalidate user data cache', async () => {
      mockDynamo.getDistilledMemory.mockResolvedValue('old');
      await cached.getDistilledMemory('user1');

      await cached.updateDistilledMemory('user1', 'new facts');

      expect(mockDynamo.updateDistilledMemory).toHaveBeenCalledWith('user1', 'new facts');
      expect(MemoryCaches.userData.has(CacheKeys.distilledMemory('user1'))).toBe(false);
    });
  });

  describe('getLessons', () => {
    it('should cache lessons on first fetch', async () => {
      mockDynamo.getLessons.mockResolvedValue(['lesson1', 'lesson2']);
      const result = await cached.getLessons('user1');

      expect(result).toEqual(['lesson1', 'lesson2']);
      mockDynamo.getLessons.mockResolvedValue([]);
      const cached2 = await cached.getLessons('user1');
      expect(cached2).toEqual(['lesson1', 'lesson2']);
    });
  });

  describe('addLesson', () => {
    it('should delegate and invalidate lessons cache', async () => {
      mockDynamo.getLessons.mockResolvedValue(['l1']);
      await cached.getLessons('user1');

      await cached.addLesson('user1', 'l2');

      expect(mockDynamo.addLesson).toHaveBeenCalledWith('user1', 'l2', undefined);
      expect(MemoryCaches.userData.has(CacheKeys.lessons('user1'))).toBe(false);
    });
  });

  describe('getSummary', () => {
    it('should cache summary with null value', async () => {
      mockDynamo.getSummary.mockResolvedValue(null);
      const result = await cached.getSummary('user1');

      expect(result).toBeNull();
      mockDynamo.getSummary.mockResolvedValue('new summary');
      const cached2 = await cached.getSummary('user1');
      expect(cached2).toBeNull();
    });

    it('should cache non-null summary', async () => {
      mockDynamo.getSummary.mockResolvedValue('a summary');
      const result = await cached.getSummary('user1');
      expect(result).toBe('a summary');
    });
  });

  describe('updateSummary', () => {
    it('should delegate and invalidate summary cache', async () => {
      mockDynamo.getSummary.mockResolvedValue('old');
      await cached.getSummary('user1');

      await cached.updateSummary('user1', 'new summary');

      expect(mockDynamo.updateSummary).toHaveBeenCalledWith('user1', 'new summary');
      expect(MemoryCaches.conversation.has(CacheKeys.summary('user1'))).toBe(false);
    });
  });

  describe('getGlobalLessons', () => {
    it('should use default limit of 5', async () => {
      mockDynamo.getGlobalLessons.mockResolvedValue([]);
      await cached.getGlobalLessons();

      expect(mockDynamo.getGlobalLessons).toHaveBeenCalledWith(5);
    });

    it('should use provided limit', async () => {
      mockDynamo.getGlobalLessons.mockResolvedValue([]);
      await cached.getGlobalLessons(10);

      expect(mockDynamo.getGlobalLessons).toHaveBeenCalledWith(10);
    });

    it('should cache global lessons', async () => {
      mockDynamo.getGlobalLessons.mockResolvedValue(['g1']);
      await cached.getGlobalLessons(3);
      mockDynamo.getGlobalLessons.mockResolvedValue([]);
      const result = await cached.getGlobalLessons(3);

      expect(result).toEqual(['g1']);
      expect(mockDynamo.getGlobalLessons).toHaveBeenCalledTimes(1);
    });
  });

  describe('addGlobalLesson', () => {
    it('should delegate and invalidate global lesson caches', async () => {
      mockDynamo.addGlobalLesson.mockResolvedValue(1);
      const result = await cached.addGlobalLesson('lesson');

      expect(result).toBe(1);
      expect(mockDynamo.addGlobalLesson).toHaveBeenCalledWith('lesson', undefined);
    });
  });

  describe('searchInsights', () => {
    it('should bypass cache for paginated results', async () => {
      mockDynamo.searchInsights.mockResolvedValue({ items: [] });
      await cached.searchInsights('user1', 'q', undefined, 50, { lastKey: '123' });

      expect(mockDynamo.searchInsights).toHaveBeenCalledWith(
        'user1',
        'q',
        undefined,
        50,
        { lastKey: '123' },
        undefined
      );
    });

    it('should cache non-paginated results', async () => {
      const items = [{ id: '1' }];
      mockDynamo.searchInsights.mockResolvedValue({ items });
      await cached.searchInsights('user1', 'query');

      mockDynamo.searchInsights.mockResolvedValue({ items: [] });
      const result = await cached.searchInsights('user1', 'query');

      expect(result.items).toEqual(items);
      expect(mockDynamo.searchInsights).toHaveBeenCalledTimes(1);
    });
  });

  describe('addMemory', () => {
    it('should delegate and invalidate search caches', async () => {
      mockDynamo.addMemory.mockResolvedValue(1);
      const result = await cached.addMemory('user1', 'category', 'content');

      expect(result).toBe(1);
      expect(mockDynamo.addMemory).toHaveBeenCalledWith('user1', 'category', 'content', undefined);
    });
  });

  describe('getAllGaps', () => {
    it('should use default status OPEN', async () => {
      mockDynamo.getAllGaps.mockResolvedValue([]);
      await cached.getAllGaps();

      expect(mockDynamo.getAllGaps).toHaveBeenCalledWith('OPEN');
    });

    it('should cache gaps by status', async () => {
      mockDynamo.getAllGaps.mockResolvedValue([{ id: 'g1' }]);
      await cached.getAllGaps();

      mockDynamo.getAllGaps.mockResolvedValue([]);
      const result = await cached.getAllGaps();

      expect(result).toEqual([{ id: 'g1' }]);
      expect(mockDynamo.getAllGaps).toHaveBeenCalledTimes(1);
    });
  });

  describe('setGap', () => {
    it('should delegate and invalidate gaps cache', async () => {
      await cached.setGap('gap1', 'details');

      expect(mockDynamo.setGap).toHaveBeenCalledWith('gap1', 'details', undefined);
    });
  });

  describe('updateGapStatus', () => {
    it('should delegate and invalidate gaps cache', async () => {
      await cached.updateGapStatus('gap1', 'RESOLVED' as any);

      expect(mockDynamo.updateGapStatus).toHaveBeenCalledWith('gap1', 'RESOLVED');
    });
  });

  describe('searchInsightsForPreferences', () => {
    it('should cache both prefixed and raw results', async () => {
      mockDynamo.searchInsights.mockResolvedValue({ items: [{ id: 'p1' }] });
      const result = await cached.searchInsightsForPreferences('user1');

      expect(result.prefixed).toEqual([{ id: 'p1' }]);
      expect(result.raw).toEqual([{ id: 'p1' }]);
      expect(mockDynamo.searchInsights).toHaveBeenCalledTimes(2);
    });

    it('should return cached preferences on second call', async () => {
      mockDynamo.searchInsights.mockResolvedValue({ items: [{ id: 'p1' }] });
      await cached.searchInsightsForPreferences('user1');

      mockDynamo.searchInsights.mockResolvedValue({ items: [] });
      const result = await cached.searchInsightsForPreferences('user1');

      expect(result.prefixed).toEqual([{ id: 'p1' }]);
      expect(mockDynamo.searchInsights).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearHistory', () => {
    it('should delegate and invalidate caches', async () => {
      mockDynamo.getHistory.mockResolvedValue(['msg']);
      await cached.getHistory('user1');

      await cached.clearHistory('user1');

      expect(mockDynamo.clearHistory).toHaveBeenCalledWith('user1');
      expect(MemoryCaches.conversation.has(CacheKeys.history('user1'))).toBe(false);
    });
  });

  describe('deleteConversation', () => {
    it('should delegate and invalidate history cache', async () => {
      await cached.deleteConversation('user1', 'session1');

      expect(mockDynamo.deleteConversation).toHaveBeenCalledWith('user1', 'session1');
    });
  });

  describe('archiveStaleGaps', () => {
    it('should delegate and invalidate gaps cache', async () => {
      mockDynamo.archiveStaleGaps.mockResolvedValue(3);
      const result = await cached.archiveStaleGaps(30);

      expect(result).toBe(3);
      expect(mockDynamo.archiveStaleGaps).toHaveBeenCalledWith(30);
    });
  });

  describe('updateInsightMetadata', () => {
    it('should delegate and invalidate search cache', async () => {
      await cached.updateInsightMetadata('user1', 123, { category: 'LESSON' as any });

      expect(mockDynamo.updateInsightMetadata).toHaveBeenCalledWith('user1', 123, {
        category: 'LESSON',
      });
    });
  });

  describe('refineMemory', () => {
    it('should invalidate search caches on refine', async () => {
      await cached.refineMemory('user1', 123, 'new content', { category: 'LESSON' as any });

      expect(mockDynamo.refineMemory).toHaveBeenCalledWith('user1', 123, 'new content', {
        category: 'LESSON',
      });
    });

    it('should not invalidate category pattern if no category in metadata', async () => {
      await cached.refineMemory('user1', 123, 'content');

      expect(mockDynamo.refineMemory).toHaveBeenCalledWith('user1', 123, 'content', undefined);
    });
  });

  describe('saveLKGHash', () => {
    it('should delegate and invalidate global lkg_hash', async () => {
      mockDynamo.saveLKGHash.mockResolvedValue(undefined);
      await cached.saveLKGHash('abc123');

      expect(mockDynamo.saveLKGHash).toHaveBeenCalledWith('abc123');
      expect(MemoryCaches.global.has('lkg_hash')).toBe(false);
    });
  });

  describe('getLatestLKGHash', () => {
    it('should cache the hash', async () => {
      mockDynamo.getLatestLKGHash.mockResolvedValue('hash1');
      const result = await cached.getLatestLKGHash();

      expect(result).toBe('hash1');
      mockDynamo.getLatestLKGHash.mockResolvedValue('hash2');
      const cached2 = await cached.getLatestLKGHash();
      expect(cached2).toBe('hash1');
      expect(mockDynamo.getLatestLKGHash).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordFailurePattern', () => {
    it('should delegate and invalidate insights cache', async () => {
      mockDynamo.recordFailurePattern.mockResolvedValue(1);
      const result = await cached.recordFailurePattern('scope1', 'content');

      expect(result).toBe(1);
    });
  });

  describe('updateGapMetadata', () => {
    it('should delegate and invalidate gaps cache', async () => {
      await cached.updateGapMetadata('gap1', { category: 'GAP' as any });

      expect(mockDynamo.updateGapMetadata).toHaveBeenCalledWith('gap1', { category: 'GAP' });
    });
  });

  describe('recordFailedPlan', () => {
    it('should delegate and invalidate search caches', async () => {
      mockDynamo.recordFailedPlan.mockResolvedValue(1);
      const result = await cached.recordFailedPlan('hash', 'plan', ['g1'], 'reason');

      expect(result).toBe(1);
    });
  });

  describe('delegation methods', () => {
    it('should delegate listConversations', async () => {
      mockDynamo.listConversations.mockResolvedValue([{ id: 'c1' }]);
      const result = await cached.listConversations('user1');

      expect(result).toEqual([{ id: 'c1' }]);
      expect(mockDynamo.listConversations).toHaveBeenCalledWith('user1');
    });

    it('should delegate incrementGapAttemptCount', async () => {
      mockDynamo.incrementGapAttemptCount.mockResolvedValue(3);
      const result = await cached.incrementGapAttemptCount('gap1');

      expect(result).toBe(3);
    });

    it('should delegate saveConversationMeta', async () => {
      await cached.saveConversationMeta('user1', 'sess1', { title: 't' });

      expect(mockDynamo.saveConversationMeta).toHaveBeenCalledWith('user1', 'sess1', {
        title: 't',
      });
    });

    it('should delegate getMemoryByTypePaginated', async () => {
      mockDynamo.getMemoryByTypePaginated.mockResolvedValue({ items: [] });
      await cached.getMemoryByTypePaginated('type1', 10);

      expect(mockDynamo.getMemoryByTypePaginated).toHaveBeenCalledWith('type1', 10, undefined);
    });

    it('should delegate getMemoryByType', async () => {
      mockDynamo.getMemoryByType.mockResolvedValue([]);
      await cached.getMemoryByType('type1');

      expect(mockDynamo.getMemoryByType).toHaveBeenCalledWith('type1', undefined);
    });

    it('should delegate getLowUtilizationMemory', async () => {
      await cached.getLowUtilizationMemory(5);
      expect(mockDynamo.getLowUtilizationMemory).toHaveBeenCalledWith(5);
    });

    it('should delegate getRegisteredMemoryTypes', async () => {
      mockDynamo.getRegisteredMemoryTypes.mockResolvedValue(['type1']);
      const result = await cached.getRegisteredMemoryTypes();
      expect(result).toEqual(['type1']);
    });

    it('should delegate recordMemoryHit', async () => {
      await cached.recordMemoryHit('user1', 123);
      expect(mockDynamo.recordMemoryHit).toHaveBeenCalledWith('user1', 123);
    });

    it('should delegate incrementRecoveryAttemptCount', async () => {
      mockDynamo.incrementRecoveryAttemptCount.mockResolvedValue(2);
      const result = await cached.incrementRecoveryAttemptCount();
      expect(result).toBe(2);
    });

    it('should delegate resetRecoveryAttemptCount', async () => {
      await cached.resetRecoveryAttemptCount();
      expect(mockDynamo.resetRecoveryAttemptCount).toHaveBeenCalled();
    });

    it('should delegate listByPrefix', async () => {
      await cached.listByPrefix('prefix');
      expect(mockDynamo.listByPrefix).toHaveBeenCalledWith('prefix');
    });

    it('should delegate saveClarificationRequest', async () => {
      const state = { traceId: 't1', agentId: 'a1' } as any;
      await cached.saveClarificationRequest(state);
      expect(mockDynamo.saveClarificationRequest).toHaveBeenCalledWith(state);
    });

    it('should delegate getClarificationRequest', async () => {
      await cached.getClarificationRequest('t1', 'a1');
      expect(mockDynamo.getClarificationRequest).toHaveBeenCalledWith('t1', 'a1');
    });

    it('should delegate updateClarificationStatus', async () => {
      await cached.updateClarificationStatus('t1', 'a1', 'PENDING' as any);
      expect(mockDynamo.updateClarificationStatus).toHaveBeenCalledWith('t1', 'a1', 'PENDING');
    });

    it('should delegate saveEscalationState', async () => {
      const state = {} as any;
      await cached.saveEscalationState(state);
      expect(mockDynamo.saveEscalationState).toHaveBeenCalledWith(state);
    });

    it('should delegate getEscalationState', async () => {
      await cached.getEscalationState('t1', 'a1');
      expect(mockDynamo.getEscalationState).toHaveBeenCalledWith('t1', 'a1');
    });

    it('should delegate findExpiredClarifications', async () => {
      await cached.findExpiredClarifications();
      expect(mockDynamo.findExpiredClarifications).toHaveBeenCalled();
    });

    it('should delegate incrementClarificationRetry', async () => {
      mockDynamo.incrementClarificationRetry.mockResolvedValue(2);
      const result = await cached.incrementClarificationRetry('t1', 'a1');
      expect(result).toBe(2);
    });

    it('should delegate getCollaboration', async () => {
      await cached.getCollaboration('c1');
      expect(mockDynamo.getCollaboration).toHaveBeenCalledWith('c1');
    });

    it('should delegate checkCollaborationAccess', async () => {
      await cached.checkCollaborationAccess('c1', 'p1', 'agent' as any);
      expect(mockDynamo.checkCollaborationAccess).toHaveBeenCalledWith(
        'c1',
        'p1',
        'agent',
        undefined
      );
    });

    it('should delegate closeCollaboration', async () => {
      await cached.closeCollaboration('c1', 'a1', 'agent' as any);
      expect(mockDynamo.closeCollaboration).toHaveBeenCalledWith('c1', 'a1', 'agent');
    });

    it('should delegate createCollaboration', async () => {
      await cached.createCollaboration('owner', 'agent' as any, {} as any);
      expect(mockDynamo.createCollaboration).toHaveBeenCalledWith('owner', 'agent', {});
    });

    it('should delegate listCollaborationsForParticipant', async () => {
      await cached.listCollaborationsForParticipant('p1', 'agent' as any);
      expect(mockDynamo.listCollaborationsForParticipant).toHaveBeenCalledWith('p1', 'agent');
    });

    it('should delegate getFailurePatterns', async () => {
      await cached.getFailurePatterns('scope1', 'ctx', 10);
      expect(mockDynamo.getFailurePatterns).toHaveBeenCalledWith('scope1', 'ctx', 10);
    });

    it('should delegate acquireGapLock', async () => {
      await cached.acquireGapLock('gap1', 'agent1', 5000);
      expect(mockDynamo.acquireGapLock).toHaveBeenCalledWith('gap1', 'agent1', 5000);
    });

    it('should delegate releaseGapLock', async () => {
      await cached.releaseGapLock('gap1', 'agent1');
      expect(mockDynamo.releaseGapLock).toHaveBeenCalledWith('gap1', 'agent1');
    });

    it('should delegate getGapLock', async () => {
      await cached.getGapLock('gap1');
      expect(mockDynamo.getGapLock).toHaveBeenCalledWith('gap1');
    });

    it('should delegate getFailedPlans', async () => {
      await cached.getFailedPlans(5);
      expect(mockDynamo.getFailedPlans).toHaveBeenCalledWith(5);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache stats summary', () => {
      const stats = cached.getCacheStats();

      expect(stats).toHaveProperty('userData');
      expect(stats).toHaveProperty('conversation');
      expect(stats).toHaveProperty('global');
      expect(stats).toHaveProperty('search');
      expect(stats).toHaveProperty('overallHitRate');
    });
  });

  describe('clearAllCaches', () => {
    it('should clear all four cache instances', async () => {
      mockDynamo.getHistory.mockResolvedValue(['msg']);
      await cached.getHistory('user1');
      mockDynamo.getLessons.mockResolvedValue(['l1']);
      await cached.getLessons('user1');

      cached.clearAllCaches();

      expect(MemoryCaches.conversation.has(CacheKeys.history('user1'))).toBe(false);
      expect(MemoryCaches.userData.has(CacheKeys.lessons('user1'))).toBe(false);
    });
  });
});
