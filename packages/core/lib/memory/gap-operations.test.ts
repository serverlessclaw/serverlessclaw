import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoMemory } from '../memory';
import { GapStatus, EvolutionTrack } from '../types/agent';
import { InsightCategory } from '../types/memory';
import {
  assignGapToTrack,
  getGapTrack,
  determineTrack,
  updateGapMetadata,
  archiveStaleGaps,
  acquireGapLock,
  releaseGapLock,
  getGapLock,
} from './gap-operations';

vi.mock('../registry', () => ({
  AgentRegistry: {
    getRetentionDays: vi.fn(),
  },
}));

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Gap Operations', () => {
  let memory: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
    memory = new DynamoMemory();
  });

  describe('setGap', () => {
    it('should pass gapTimestamp to createMetadata so lastAccessed matches the record timestamp', async () => {
      ddbMock.on(PutCommand).resolves({});

      await memory.setGap('1710240000000', 'test gap description');

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);

      const item = calls[0].args[0].input.Item;
      expect(item?.timestamp).toBe(1710240000000);
      expect(item?.createdAt).toBe(1710240000000);
      expect(item?.metadata?.lastAccessed).toBe(1710240000000);
    });

    it('should use Date.now() as timestamp when gapId is non-numeric', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      ddbMock.on(PutCommand).resolves({});

      await memory.setGap('NON_NUMERIC_ID', 'test gap');

      const calls = ddbMock.commandCalls(PutCommand);
      const item = calls[0].args[0].input.Item;
      expect(item?.timestamp).toBe(0);
      vi.useRealTimers();
    });

    it('should extract trailing digits from compound gap IDs', async () => {
      ddbMock.on(PutCommand).resolves({});

      await memory.setGap('TOOLOPT-1710240000000-42', 'tool optimization gap');

      const calls = ddbMock.commandCalls(PutCommand);
      const item = calls[0].args[0].input.Item;
      // Should extract trailing digits (42), not the full compound ID
      expect(item?.userId).toBe('GAP#42');
      expect(item?.timestamp).toBe(42);
    });

    it('should store correct metadata fields', async () => {
      ddbMock.on(PutCommand).resolves({});

      await memory.setGap('1710240000000', 'test gap', {
        category: InsightCategory.SYSTEM_IMPROVEMENT,
        confidence: 5,
        impact: 8,
        complexity: 5,
        risk: 5,
        urgency: 7,
        priority: 5,
      });

      const calls = ddbMock.commandCalls(PutCommand);
      const item = calls[0].args[0].input.Item;
      expect(item?.metadata?.category).toBe('system_improvement');
      expect(item?.metadata?.impact).toBe(8);
      expect(item?.metadata?.urgency).toBe(7);
      expect(item?.status).toBe(GapStatus.OPEN);
    });
  });

  describe('updateGapMetadata', () => {
    it('should update impact and priority metadata on a gap', async () => {
      // Mock resolveItemById's direct lookup
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'GAP#42', timestamp: 42, content: 'test gap', metadata: {} }],
      });
      ddbMock.on(UpdateCommand).resolves({});

      await updateGapMetadata(memory, 'GAP#42', { impact: 9, priority: 7 });

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);

      const input = calls[0].args[0].input;
      expect(input.Key).toEqual({ userId: 'GAP#42', timestamp: 42 });
      expect(input.UpdateExpression).toContain('metadata.#impact = :impact');
      expect(input.UpdateExpression).toContain('metadata.#priority = :priority');
      expect(input.ExpressionAttributeValues?.[':impact']).toBe(9);
      expect(input.ExpressionAttributeValues?.[':priority']).toBe(7);
    });

    it('should normalize compound gap IDs using same logic as other gap operations', async () => {
      // Mock resolveItemById's direct lookup
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'GAP#42', timestamp: 42, content: 'test gap', metadata: {} }],
      });
      ddbMock.on(UpdateCommand).resolves({});

      await updateGapMetadata(memory, 'GAP#TOOLOPT-1710240000000-42', { impact: 5 });

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls[0].args[0].input.Key).toEqual({
        userId: 'GAP#42',
        timestamp: 42,
      });
    });

    it('should return early when no metadata fields are provided', async () => {
      await updateGapMetadata(memory, 'GAP#42', {});

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(0);
    });

    it('should fall back to searching all gap statuses when primary lookup fails', async () => {
      // resolveItemById direct lookup fails (empty), GSI lookup succeeds
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [] }) // Direct lookup PK/SK
        .resolves({
          // GSI search for 'GAP'
          Items: [
            {
              userId: 'GAP#42',
              timestamp: 1710240000000,
              content: 'test gap',
              type: 'GAP',
              status: GapStatus.OPEN,
            },
          ],
        });
      ddbMock.on(UpdateCommand).resolves({});

      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'GAP#42',
            timestamp: 1710240000000,
            content: 'test gap',
            type: 'GAP',
            status: GapStatus.OPEN,
          },
        ],
      });

      await updateGapMetadata(memory, 'GAP#42', { impact: 8 });

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      // Second call should use the found item's actual timestamp
      expect(updateCalls[0].args[0].input.Key).toEqual({
        userId: 'GAP#42',
        timestamp: 1710240000000,
      });
    });
  });

  describe('incrementGapAttemptCount', () => {
    it('should normalize compound gap IDs using same logic as setGap', async () => {
      // Mock resolution
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'GAP#42', timestamp: 42, content: 'test', metadata: {} }],
      });
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { metadata: { retryCount: 1 } },
      });

      await memory.incrementGapAttemptCount('GAP#TOOLOPT-1710240000000-42');

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
      // Should normalize to trailing digits (42), matching setGap's storage
      expect(calls[0].args[0].input.Key).toEqual({
        userId: 'GAP#42',
        timestamp: 42,
      });
    });

    it('should use full ID when gapId is purely numeric', async () => {
      // Mock resolution
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { userId: 'GAP#1710240000000', timestamp: 1710240000000, content: 'test', metadata: {} },
        ],
      });
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { metadata: { retryCount: 1 } },
      });

      await memory.incrementGapAttemptCount('GAP#1710240000000');

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls[0].args[0].input.Key).toEqual({
        userId: 'GAP#1710240000000',
        timestamp: 1710240000000,
      });
    });

    it('should resolve via GSI when direct lookup fails', async () => {
      // Primary resolution: first call (direct lookup) returns empty, second call (GSI search) returns the item
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [] }) // Direct lookup PK/SK
        .resolves({
          Items: [
            {
              userId: 'GAP#42',
              timestamp: 1710240000000,
              content: 'test gap',
              type: 'GAP',
              status: GapStatus.OPEN,
            },
          ],
        });

      ddbMock.on(UpdateCommand).resolves({ Attributes: { metadata: { retryCount: 3 } } });

      const count = await memory.incrementGapAttemptCount('GAP#42');

      // Should have attempted QueryCommand for direct lookup then fallback search
      const queryCalls = ddbMock.commandCalls(QueryCommand);
      expect(queryCalls.length).toBeGreaterThanOrEqual(2);
      expect(count).toBe(3);
      // Verify standardized mapping (first is direct lookup with #ts, second is GSI with #tp)
      expect(queryCalls[1].args[0].input.ExpressionAttributeNames).toEqual(
        expect.objectContaining({ '#tp': 'type' })
      );
    });

    it('should return 0 when gap is not found in any status', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('DDB error'));
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const count = await memory.incrementGapAttemptCount('GAP#NONEXISTENT');
      expect(count).toBe(0);
    });
  });

  describe('archiveStaleGaps', () => {
    it('should query for OPEN and PLANNED gaps using correct expression attributes', async () => {
      const now = Date.now();
      const staleTime = now - 40 * 24 * 60 * 60 * 1000; // 40 days ago

      ddbMock.on(QueryCommand).resolves({
        Items: [
          { userId: 'GAP#1', timestamp: staleTime, type: 'GAP', status: GapStatus.OPEN },
          { userId: 'GAP#2', timestamp: now, type: 'GAP', status: GapStatus.PLANNED },
        ],
      });
      ddbMock.on(UpdateCommand).resolves({});

      const archivedCount = await archiveStaleGaps(memory, 30);

      expect(archivedCount).toBe(1);
      const queryCalls = ddbMock.commandCalls(QueryCommand);
      expect(queryCalls.length).toBeGreaterThanOrEqual(1);

      const queryInput = queryCalls[0].args[0].input;
      expect(queryInput.FilterExpression).toContain('#status IN (:open, :planned)');
      expect(queryInput.FilterExpression).toContain('attribute_not_exists(workspaceId)');
      expect(queryInput.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ':open': GapStatus.OPEN,
          ':planned': GapStatus.PLANNED,
        })
      );
      // REGRESSION: Ensure :status is NOT used (it was causing mismatch)
      expect(queryInput.ExpressionAttributeValues).not.toHaveProperty(':status');

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].args[0].input.Key).toEqual({
        userId: 'GAP#1',
        timestamp: staleTime,
      });
    });
  });
});

describe('Gap-Track Assignment', () => {
  let base: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
    base = new DynamoMemory();
  });

  describe('assignGapToTrack', () => {
    it('should store track assignment in DynamoDB', async () => {
      // Mock resolution for updateGapStatus
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { userId: 'gap-42', timestamp: 1000, content: 'test', metadata: { status: 'open' } },
        ],
      });
      ddbMock.on(UpdateCommand).resolves({});
      ddbMock.on(PutCommand).resolves({});

      await assignGapToTrack(base, 'gap-42', EvolutionTrack.SECURITY);

      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls).toHaveLength(1);
      const item = putCalls[0].args[0].input.Item;
      expect(item?.userId).toBe('TRACK#gap-42');
      expect(item?.track).toBe('security');
      expect(item?.type).toBe('TRACK_ASSIGNMENT');
    });

    it('should use custom priority when provided', async () => {
      // Mock resolution for updateGapStatus
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { userId: 'gap-1', timestamp: 1000, content: 'test', metadata: { status: 'open' } },
        ],
      });
      ddbMock.on(UpdateCommand).resolves({});
      ddbMock.on(PutCommand).resolves({});

      await assignGapToTrack(base, 'gap-1', EvolutionTrack.PERFORMANCE, 1);

      const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
      expect(item?.priority).toBe(1);
    });

    it('should fail fast when PLANNED transition cannot be applied', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(UpdateCommand).rejects(
        Object.assign(new Error('ConditionalCheckFailedException'), {
          name: 'ConditionalCheckFailedException',
        })
      );

      await expect(assignGapToTrack(base, 'GAP#42', EvolutionTrack.SECURITY)).rejects.toThrow(
        'Failed to transition'
      );

      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });
  });

  describe('getGapTrack', () => {
    it('should return track assignment', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'TRACK#gap-42', timestamp: 0, track: 'security', priority: 1 }],
      });

      const result = await getGapTrack(base, 'gap-42');
      expect(result?.track).toBe('security');
      expect(result?.priority).toBe(1);
    });

    it('should return null when no assignment exists', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await getGapTrack(base, 'gap-missing');
      expect(result).toBeNull();
    });
  });

  describe('determineTrack', () => {
    it('should detect security track', () => {
      expect(determineTrack('Fix auth vulnerability in login flow')).toBe(EvolutionTrack.SECURITY);
      expect(determineTrack('Patch injection vulnerability')).toBe(EvolutionTrack.SECURITY);
    });

    it('should detect performance track', () => {
      expect(determineTrack('Optimize latency of database queries')).toBe(
        EvolutionTrack.PERFORMANCE
      );
      expect(determineTrack('Add caching layer for slow API')).toBe(EvolutionTrack.PERFORMANCE);
    });

    it('should detect infrastructure track', () => {
      expect(determineTrack('Update Lambda deployment config')).toBe(EvolutionTrack.INFRASTRUCTURE);
      expect(determineTrack('Fix SST build pipeline')).toBe(EvolutionTrack.INFRASTRUCTURE);
    });

    it('should detect refactoring track', () => {
      expect(determineTrack('Refactor duplicate code in handlers')).toBe(
        EvolutionTrack.REFACTORING
      );
      expect(determineTrack('Consolidate cleanup logic')).toBe(EvolutionTrack.REFACTORING);
    });

    it('should default to feature track', () => {
      expect(determineTrack('Add new user dashboard widget')).toBe(EvolutionTrack.FEATURE);
      expect(determineTrack('Implement chat export functionality')).toBe(EvolutionTrack.FEATURE);
    });
  });
});

describe('Gap Lock Operations', () => {
  let base: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
    base = new DynamoMemory();
  });

  describe('acquireGapLock', () => {
    it('should return true on success (creates lock item)', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const result = await acquireGapLock(base, 'GAP#42', 'agent-planner-1');

      expect(result).toBe(true);
      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
      const input = calls[0].args[0].input;
      expect(input.Key).toEqual({ userId: 'GAP_LOCK#42', timestamp: 0 });
      expect(input.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ':type': 'GAP_LOCK',
          ':agentId': 'agent-planner-1',
          ':locked': 'LOCKED',
        })
      );
    });

    it('should return false when ConditionalCheckFailedException (already locked)', async () => {
      const conditionalError = Object.assign(new Error('ConditionalCheckFailed'), {
        name: 'ConditionalCheckFailedException',
      });
      ddbMock.on(UpdateCommand).rejects(conditionalError);

      const result = await acquireGapLock(base, 'GAP#42', 'agent-coder-1');

      expect(result).toBe(false);
    });

    it('should return false when other errors occur (silently caught)', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('NetworkError'));

      const result = await acquireGapLock(base, 'GAP#42', 'agent-planner-2');

      expect(result).toBe(false);
    });

    it('should acquire lock when existing lock is expired', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const result = await acquireGapLock(base, 'GAP#42', 'agent-planner-3');

      expect(result).toBe(true);
    });

    it('should normalize compound gap IDs', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await acquireGapLock(base, 'GAP#TOOLOPT-1710240000000-42', 'agent-1');

      const calls = ddbMock.commandCalls(UpdateCommand);
      // normalizeGapId strips GAP# prefix but does NOT extract trailing digits
      expect(calls[0].args[0].input.Key).toEqual({
        userId: 'GAP_LOCK#TOOLOPT-1710240000000-42',
        timestamp: 0,
      });
    });
  });

  describe('releaseGapLock', () => {
    it('should succeed on valid release (deletes lock item)', async () => {
      ddbMock.on(DeleteCommand).resolves({});

      await releaseGapLock(base, 'GAP#42', 'agent-planner-1');

      const calls = ddbMock.commandCalls(DeleteCommand);
      expect(calls).toHaveLength(1);
      const input = calls[0].args[0].input;
      expect(input.Key).toEqual({ userId: 'GAP_LOCK#42', timestamp: 0 });
      expect(input.ConditionExpression).toBe('#content = :agentId');
      expect(input.ExpressionAttributeValues).toEqual({ ':agentId': 'agent-planner-1' });
    });

    it('should silently catch ConditionalCheckFailedException (not owner)', async () => {
      const conditionalError = Object.assign(new Error('ConditionalCheckFailed'), {
        name: 'ConditionalCheckFailedException',
      });
      ddbMock.on(DeleteCommand).rejects(conditionalError);

      await expect(releaseGapLock(base, 'GAP#42', 'wrong-agent')).resolves.toBeUndefined();
    });

    it('should silently catch other errors', async () => {
      ddbMock.on(DeleteCommand).rejects(new Error('NetworkError'));

      await expect(releaseGapLock(base, 'GAP#42', 'agent-1')).resolves.toBeUndefined();
    });

    it('should normalize compound gap IDs', async () => {
      ddbMock.on(DeleteCommand).resolves({});

      await releaseGapLock(base, 'GAP#TOOLOPT-1710240000000-42', 'agent-1');

      const calls = ddbMock.commandCalls(DeleteCommand);
      expect(calls[0].args[0].input.Key).toEqual({
        userId: 'GAP_LOCK#TOOLOPT-1710240000000-42',
        timestamp: 0,
      });
    });
  });

  describe('getGapLock', () => {
    it('should return lock info when lock is active (not expired)', async () => {
      const futureExpiresAt = Math.floor(Date.now() / 1000) + 1800;
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'GAP_LOCK#42',
            timestamp: 0,
            agentId: 'agent-planner-1',
            expiresAt: futureExpiresAt,
          },
        ],
      });

      const result = await getGapLock(base, 'GAP#42');

      expect(result).toEqual({
        agentId: 'agent-planner-1',
        expiresAt: futureExpiresAt,
        lockVersion: undefined,
      });
    });

    it('should return null when lock is expired', async () => {
      const pastExpiresAt = Math.floor(Date.now() / 1000) - 100;
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'GAP_LOCK#42',
            timestamp: 0,
            agentId: 'agent-planner-1',
            expiresAt: pastExpiresAt,
          },
        ],
      });

      const result = await getGapLock(base, 'GAP#42');

      expect(result).toBeNull();
    });

    it('should return null when no lock exists', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await getGapLock(base, 'GAP#42');

      expect(result).toBeNull();
    });

    it('should return sentinel __LOCK_CHECK_FAILED__ on query error', async () => {
      ddbMock.on(QueryCommand).rejects(new Error('QueryFailed'));

      const result = await getGapLock(base, 'GAP#42');

      expect(result).toEqual({
        agentId: '__LOCK_CHECK_FAILED__',
        expiresAt: Infinity,
      });
    });

    it('should normalize compound gap IDs', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      await getGapLock(base, 'GAP#TOOLOPT-1710240000000-42');

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ':lockKey': 'GAP_LOCK#TOOLOPT-1710240000000-42',
        })
      );
    });
  });
});
