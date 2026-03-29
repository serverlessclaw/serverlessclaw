import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoMemory } from '../memory';
import { GapStatus, EvolutionTrack } from '../types/agent';
import { InsightCategory } from '../types/memory';
import { assignGapToTrack, getGapTrack, determineTrack } from './gap-operations';

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
      expect(item?.metadata?.createdAt).toBe(1710240000000);
    });

    it('should use Date.now() as timestamp when gapId is non-numeric', async () => {
      const now = 1710240000000;
      vi.setSystemTime(now);
      ddbMock.on(PutCommand).resolves({});

      await memory.setGap('NON_NUMERIC_ID', 'test gap');

      const calls = ddbMock.commandCalls(PutCommand);
      const item = calls[0].args[0].input.Item;
      expect(item?.timestamp).toBe(now);
      expect(item?.createdAt).toBe(now);
      expect(item?.metadata?.lastAccessed).toBe(now);
      expect(item?.metadata?.createdAt).toBe(now);

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

  describe('incrementGapAttemptCount', () => {
    it('should normalize compound gap IDs using same logic as setGap', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { attemptCount: 1 },
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
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { attemptCount: 1 },
      });

      await memory.incrementGapAttemptCount('GAP#1710240000000');

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls[0].args[0].input.Key).toEqual({
        userId: 'GAP#1710240000000',
        timestamp: 1710240000000,
      });
    });

    it('should fall back to searching all gap statuses when primary lookup fails', async () => {
      // Primary update fails once, then fallback update succeeds
      ddbMock
        .on(UpdateCommand)
        .rejectsOnce(new Error('DDB error'))
        .resolves({ Attributes: { attemptCount: 3 } });

      // Fallback: QueryCommand returns gaps found across statuses
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

      const count = await memory.incrementGapAttemptCount('GAP#42');

      // Should have attempted QueryCommand for fallback search
      const queryCalls = ddbMock.commandCalls(QueryCommand);
      expect(queryCalls.length).toBeGreaterThanOrEqual(1);
      expect(count).toBe(3);
    });

    it('should return 1 when gap is not found in any status', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('DDB error'));
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const count = await memory.incrementGapAttemptCount('GAP#NONEXISTENT');
      expect(count).toBe(1);
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
      ddbMock.on(PutCommand).resolves({});

      await assignGapToTrack(base, 'gap-1', EvolutionTrack.PERFORMANCE, 1);

      const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
      expect(item?.priority).toBe(1);
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
