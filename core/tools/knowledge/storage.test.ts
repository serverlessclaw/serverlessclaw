import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GapStatus } from '../../lib/types/agent';
import { InsightCategory } from '../../lib/types/memory';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  recallKnowledge,
  manageGap,
  saveMemory,
  pruneMemory,
  discoverSkills,
  installSkill,
  uninstallSkill,
  reportGap,
  prioritizeMemory,
  forceReleaseLock,
  deleteTraces,
  refineMemory,
} from './storage';
import { inspectTrace } from './metadata';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

// Hoist mocks to ensure they are available for vi.mock
const mocks = vi.hoisted(() => ({
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  getAllGaps: vi.fn().mockResolvedValue([]),
  getDistilledMemory: vi.fn().mockResolvedValue(''),
  updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  setGap: vi.fn().mockResolvedValue(undefined),
  addMemory: vi.fn().mockResolvedValue(123456789),
  recordMemoryHit: vi.fn().mockResolvedValue(undefined),
  deleteItem: vi.fn().mockResolvedValue(undefined),
  updateInsightMetadata: vi.fn().mockResolvedValue(undefined),
  searchInsights: vi.fn().mockResolvedValue({
    items: [
      {
        id: 'insight-1',
        timestamp: 123,
        content: 'insight 1',
        metadata: { category: 'lesson', impact: 10, urgency: 10 },
      },
    ],
  }),
  discoverSkills: vi.fn().mockResolvedValue([{ name: 'test-skill', description: 'test desc' }]),
  installSkill: vi.fn().mockResolvedValue(undefined),
  getRawConfig: vi.fn().mockResolvedValue(['test-skill']),
  saveRawConfig: vi.fn().mockResolvedValue(undefined),
  getTrace: vi.fn().mockResolvedValue([
    {
      nodeId: 'node-1',
      status: 'completed',
      steps: [{ timestamp: Date.now(), type: 'llm_call', content: 'hello' }],
    },
  ]),
  refineMemory: vi.fn().mockResolvedValue(undefined),
}));

// Mock all dependencies in one place to avoid collisions
vi.mock('../../lib/memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function () {
    return {
      searchInsights: mocks.searchInsights,
      updateGapStatus: mocks.updateGapStatus,
      getAllGaps: mocks.getAllGaps,
      getDistilledMemory: mocks.getDistilledMemory,
      updateDistilledMemory: mocks.updateDistilledMemory,
      setGap: mocks.setGap,
      addMemory: mocks.addMemory,
      recordMemoryHit: mocks.recordMemoryHit,
      deleteItem: mocks.deleteItem,
      updateInsightMetadata: mocks.updateInsightMetadata,
      refineMemory: mocks.refineMemory,
    };
  }),
}));

vi.mock('../../lib/tracer', () => ({
  ClawTracer: {
    getTrace: mocks.getTrace,
  },
}));

vi.mock('../../lib/skills', () => ({
  SkillRegistry: {
    discoverSkills: mocks.discoverSkills,
    installSkill: mocks.installSkill,
  },
}));

vi.mock('../../lib/registry', () => ({
  AgentRegistry: {
    getRawConfig: mocks.getRawConfig,
  },
}));

vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: mocks.getRawConfig,
    saveRawConfig: mocks.saveRawConfig,
  },
  defaultDocClient: {
    send: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('sst', () => ({
  Resource: {
    TraceTable: { name: 'test-trace-table' },
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
  },
}));

describe('knowledge-storage tools', () => {
  beforeEach(() => {
    ddbMock.reset();
    ebMock.reset();
    vi.clearAllMocks();
  });

  describe('recallKnowledge', () => {
    it('should return search results from memory', async () => {
      const result = await recallKnowledge.execute({
        userId: 'user-1',
        query: 'test',
        category: 'tactical_lesson',
      });
      expect(result).toContain('insight 1');
      expect(mocks.searchInsights).toHaveBeenCalledWith(
        'user-1',
        'test',
        'tactical_lesson',
        50,
        undefined,
        undefined,
        undefined
      );
    });
    it('should search both prefixed and raw for user_preference', async () => {
      await recallKnowledge.execute({
        userId: 'user-1',
        query: 'coffee',
        category: 'user_preference',
      });
      expect(mocks.searchInsights).toHaveBeenCalledWith(
        'user-1',
        'coffee',
        'user_preference',
        50,
        undefined,
        undefined,
        undefined
      );
      expect(mocks.searchInsights).toHaveBeenCalledTimes(1);
    });
  });

  describe('manageGap', () => {
    it('should update gap status in memory', async () => {
      const result = await manageGap.execute({ gapId: 'gap-1', status: GapStatus.PLANNED });
      expect(result).toContain('Successfully updated gap gap-1 to PLANNED');
      expect(mocks.updateGapStatus).toHaveBeenCalledWith('gap-1', GapStatus.PLANNED);
    });

    it('should list open gaps sorted by impact desc', async () => {
      mocks.getAllGaps.mockResolvedValueOnce([
        {
          id: 'gap-low',
          content: 'low impact gap',
          metadata: { impact: 2, urgency: 4 },
        },
        {
          id: 'gap-high',
          content: 'high impact gap',
          metadata: { impact: 9, urgency: 7 },
        },
      ]);

      const result = await manageGap.execute({ action: 'list' });

      expect(mocks.getAllGaps).toHaveBeenCalledWith(GapStatus.OPEN);
      expect(result).toContain('Found 2 open capability gaps');
      expect(result.indexOf('gap-high')).toBeLessThan(result.indexOf('gap-low'));
    });

    it('should return friendly message when no open gaps exist for list action', async () => {
      mocks.getAllGaps.mockResolvedValueOnce([]);

      const result = await manageGap.execute({ action: 'list' });

      expect(result).toBe('No open capability gaps found.');
    });
  });

  describe('saveMemory', () => {
    it('should save user preference to memory with semantic deduplication attempt', async () => {
      mocks.searchInsights
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [] });

      const result = await saveMemory.execute({
        userId: 'user-1',
        content: 'likes coffee',
        category: 'user_preference',
      });
      expect(result).toContain('Successfully saved knowledge as MEMORY:USER_PREFERENCE');
      expect(mocks.addMemory).toHaveBeenCalledWith(
        'USER#user-1',
        InsightCategory.USER_PREFERENCE,
        'likes coffee',
        expect.any(Object)
      );
    });

    it('should save general knowledge as system memory', async () => {
      const result = await saveMemory.execute({
        userId: 'user-1',
        content: 'new fact',
        category: 'system_knowledge',
      });
      expect(result).toContain('Successfully saved knowledge as MEMORY:SYSTEM_KNOWLEDGE');
      expect(mocks.addMemory).toHaveBeenCalledWith(
        'SYSTEM#GLOBAL',
        InsightCategory.SYSTEM_KNOWLEDGE,
        'new fact',
        expect.any(Object)
      );
    });
  });

  describe('pruneMemory', () => {
    it('should permanently delete a memory item from DDB', async () => {
      const result = await pruneMemory.execute({
        partitionKey: 'LESSON#user-1',
        timestamp: 123456,
      });

      expect(result).toContain('Successfully pruned memory item');
      expect(mocks.deleteItem).toHaveBeenCalledWith({
        userId: 'LESSON#user-1',
        timestamp: 123456,
      });
    });

    describe('inspectTrace', () => {
      it('should return trace summary', async () => {
        const result = await inspectTrace.execute({ traceId: 'trace-1' });
        expect(result).toContain('--- NODE: node-1');
        expect(result).toContain('[LLM_CALL] hello');
      });
    });

    describe('discoverSkills', () => {
      it('should list matching skills', async () => {
        const result = await discoverSkills.execute({ query: 'test' });
        expect(result).toContain('Found 1 matching skills');
        expect(result).toContain('test-skill: test desc');
      });
    });

    describe('installSkill', () => {
      it('should install skill for target agent', async () => {
        const result = await installSkill.execute({ skillName: 'test-skill', agentId: 'coder' });
        expect(result).toContain("Skill 'test-skill' successfully installed for agent coder");
      });
    });

    describe('uninstallSkill', () => {
      it('should uninstall skill for target agent', async () => {
        const result = await uninstallSkill.execute({ skillName: 'test-skill', agentId: 'coder' });
        expect(result).toContain("Successfully uninstalled skill 'test-skill'");
      });

      it('should fail if skill is not installed', async () => {
        mocks.getRawConfig.mockResolvedValueOnce([]);

        const result = await uninstallSkill.execute({ skillName: 'wrong-skill', agentId: 'coder' });
        expect(result).toContain("FAILED: Skill 'wrong-skill' is not installed");
      });
    });

    describe('reportGap', () => {
      it('should record gap and emit EVOLUTION_PLAN event', async () => {
        ebMock.on(PutEventsCommand).resolves({});

        const result = await reportGap.execute({
          userId: 'user-1',
          content: 'missing feature X',
          impact: 10,
          urgency: 8,
        });

        expect(result).toContain('Successfully recorded new gap');
        expect(mocks.addMemory).toHaveBeenCalledWith(
          'SYSTEM#GLOBAL',
          InsightCategory.STRATEGIC_GAP,
          'missing feature X',
          expect.objectContaining({ impact: 10, urgency: 8 })
        );
      });
    });

    describe('prioritizeMemory', () => {
      it('should update priority, urgency, and impact via updateInsightMetadata', async () => {
        const result = await prioritizeMemory.execute({
          userId: 'LESSON#abc',
          timestamp: 123456,
          priority: 9,
          urgency: 7,
          impact: 8,
        });

        expect(result).toContain('Successfully updated memory LESSON#abc@123456');
        expect(mocks.updateInsightMetadata).toHaveBeenCalledWith(
          'LESSON#abc',
          123456,
          expect.objectContaining({ priority: 9, urgency: 7, impact: 8 })
        );
      });

      it('should fail when no scores provided', async () => {
        const result = await prioritizeMemory.execute({
          userId: 'LESSON#abc',
          timestamp: 123456,
        });

        expect(result).toContain('FAILED: No update parameters provided');
      });

      it('should allow partial updates', async () => {
        const result = await prioritizeMemory.execute({
          userId: 'GAP#123',
          timestamp: 999111,
          urgency: 10,
        });

        expect(result).toContain('Successfully updated memory GAP#123@999111');
        expect(mocks.updateInsightMetadata).toHaveBeenCalledWith(
          'GAP#123',
          999111,
          expect.objectContaining({ urgency: 10 })
        );
      });
    });

    describe('forceReleaseLock', () => {
      it('should delete the lock item from memory', async () => {
        const result = await forceReleaseLock.execute({
          lockId: 'LOCK#session-abc',
        });

        expect(result).toContain('Successfully force-released lock: LOCK#session-abc');
        expect(mocks.deleteItem).toHaveBeenCalledWith({
          userId: 'LOCK#session-abc',
          timestamp: 0,
          ConditionExpression: '#type = :lockType',
          ExpressionAttributeNames: { '#type': 'type' },
          ExpressionAttributeValues: { ':lockType': 'LOCK' },
        });
      });

      it('should fail when lockId is missing', async () => {
        const result = await forceReleaseLock.execute({});
        expect(result).toContain('FAILED: lockId is required');
      });

      it('should return specific message when ConditionalCheckFailedException is thrown', async () => {
        const conditionalCheckError = new Error('ConditionalCheckFailed');
        conditionalCheckError.name = 'ConditionalCheckFailedException';
        mocks.deleteItem.mockRejectedValueOnce(conditionalCheckError);

        const result = await forceReleaseLock.execute({
          lockId: 'LOCK#session-abc',
        });

        expect(result).toContain(
          'FAILED: Item LOCK#session-abc is not a valid lock or has already been released'
        );
      });

      it('should return generic error message for non-conditional errors', async () => {
        mocks.deleteItem.mockRejectedValueOnce(new Error('Network timeout'));

        const result = await forceReleaseLock.execute({
          lockId: 'LOCK#session-xyz',
        });

        expect(result).toContain('Failed to release lock: Network timeout');
      });
    });

    describe('deleteTraces', () => {
      it('should fail when traceId is missing', async () => {
        const result = await deleteTraces.execute({});
        expect(result).toContain('FAILED: traceId is required');
      });
    });

    describe('refineMemory', () => {
      it('should successfully refine memory with content, tags, and priority', async () => {
        const result = await refineMemory.execute({
          userId: 'LESSON#user-1',
          timestamp: 123456,
          content: 'updated content',
          tags: ['important', 'reviewed'],
          priority: 8,
        });

        expect(result).toContain('Successfully refined memory item: LESSON#user-1@123456');
        expect(mocks.refineMemory).toHaveBeenCalledWith(
          'LESSON#user-1',
          123456,
          'updated content',
          {
            tags: ['important', 'reviewed'],
            priority: 8,
          }
        );
      });

      it('should refine memory with only content', async () => {
        const result = await refineMemory.execute({
          userId: 'GAP#abc',
          timestamp: 987654,
          content: 'new content',
        });

        expect(result).toContain('Successfully refined memory item: GAP#abc@987654');
        expect(mocks.refineMemory).toHaveBeenCalledWith('GAP#abc', 987654, 'new content', {
          tags: undefined,
          priority: undefined,
        });
      });

      it('should refine memory with only tags', async () => {
        const result = await refineMemory.execute({
          userId: 'USER#test',
          timestamp: 111222,
          tags: ['archived'],
        });

        expect(result).toContain('Successfully refined memory item: USER#test@111222');
        expect(mocks.refineMemory).toHaveBeenCalledWith('USER#test', 111222, undefined, {
          tags: ['archived'],
          priority: undefined,
        });
      });

      it('should refine memory with only priority', async () => {
        const result = await refineMemory.execute({
          userId: 'LESSON#xyz',
          timestamp: 333444,
          priority: 10,
        });

        expect(result).toContain('Successfully refined memory item: LESSON#xyz@333444');
        expect(mocks.refineMemory).toHaveBeenCalledWith('LESSON#xyz', 333444, undefined, {
          tags: undefined,
          priority: 10,
        });
      });

      it('should fail when userId is missing', async () => {
        const result = await refineMemory.execute({
          timestamp: 123456,
        });

        expect(result).toContain('FAILED: userId and timestamp are required');
      });

      it('should fail when timestamp is missing', async () => {
        const result = await refineMemory.execute({
          userId: 'LESSON#user-1',
        });

        expect(result).toContain('FAILED: userId and timestamp are required');
      });

      it('should return error message when refineMemory throws', async () => {
        mocks.refineMemory.mockRejectedValueOnce(new Error('Item not found'));

        const result = await refineMemory.execute({
          userId: 'LESSON#nonexistent',
          timestamp: 999999,
          content: 'update',
        });

        expect(result).toContain('Failed to refine memory: Item not found');
      });
    });
  });
});
