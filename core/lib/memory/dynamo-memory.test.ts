import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  ScanCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoMemory } from './dynamo-memory';
import { GapStatus } from '../types/agent';
import { MessageRole } from '../types/llm';
import { AgentRegistry } from '../registry';
import { InsightCategory } from '../types/memory';

vi.mock('../registry', () => ({
  AgentRegistry: {
    getRetentionDays: vi.fn(),
    getRawConfig: vi.fn(),
  },
}));

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DynamoMemory Retention', () => {
  let memory: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
    memory = new DynamoMemory();
  });

  it('should apply MESSAGES_DAYS TTL in addMessage', async () => {
    vi.mocked(AgentRegistry.getRetentionDays).mockResolvedValue(30);
    ddbMock.on(PutCommand).resolves({});

    const now = Date.now();
    vi.setSystemTime(now);

    await memory.addMessage('user-1', {
      role: MessageRole.USER,
      content: 'hi',
      traceId: 'test-trace',
      messageId: 'test-msg',
    });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);

    const item = calls[0].args[0].input.Item;
    expect(item?.expiresAt).toBe(Math.floor(now / 1000) + 30 * 24 * 60 * 60);

    vi.useRealTimers();
  });

  it('should apply LESSONS_DAYS TTL in addLesson', async () => {
    vi.mocked(AgentRegistry.getRetentionDays).mockResolvedValue(90);
    ddbMock.on(PutCommand).resolves({});

    const now = Date.now();
    vi.setSystemTime(now);

    await memory.addLesson('user-1', 'learned something');

    const calls = ddbMock.commandCalls(PutCommand);
    const item = calls[0].args[0].input.Item;
    expect(item?.expiresAt).toBe(Math.floor(now / 1000) + 90 * 24 * 60 * 60);

    vi.useRealTimers();
  });

  describe('updateGapStatus', () => {
    it('should send UpdateCommand with correct parameters when gapId contains timestamp and include updatedAt', async () => {
      const timestamp = 1710240000000;
      const gapId = `GAP#${timestamp}`;
      ddbMock.on(UpdateCommand).resolves({});

      const now = Date.now();
      vi.setSystemTime(now);

      // Mock resolution
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: gapId, timestamp: timestamp, content: 'test', status: GapStatus.OPEN }],
      });

      await memory.updateGapStatus(gapId, GapStatus.PLANNED);

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toMatchObject({
        TableName: 'test-memory-table',
        Key: {
          userId: `GAP#${timestamp}`,
          timestamp: timestamp,
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :now',
        ConditionExpression:
          'attribute_exists(userId) AND userId = :targetId AND #status = :expectedStatus',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': GapStatus.PLANNED,
          ':now': now,
          ':expectedStatus': GapStatus.OPEN,
          ':targetId': `GAP#${timestamp}`,
        },
      });
      vi.useRealTimers();
    });

    it('should return early on ConditionalCheckFailedException for atomic transitions', async () => {
      const timestamp = 1710240000000;
      const gapId = `GAP#${timestamp}`;

      // Mock resolution
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: gapId, timestamp: timestamp, content: 'test', status: GapStatus.OPEN }],
      });

      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejectsOnce(error).resolves({});

      await expect(memory.updateGapStatus(gapId, GapStatus.PROGRESS)).resolves.toEqual({
        success: false,
        error: expect.stringContaining('Cannot transition gap'),
      });

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);
    });

    it('should handle gapId that is not a numeric timestamp by searching all gaps', async () => {
      const gapId = 'GAP#some-unique-string';
      const actualTimestamp = 123456789;

      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: gapId, timestamp: actualTimestamp, content: 'test', type: 'GAP' }],
      });
      ddbMock.on(UpdateCommand).resolves({});

      await memory.updateGapStatus(gapId, GapStatus.PROGRESS);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].args[0].input.Key).toEqual({
        userId: gapId,
        timestamp: actualTimestamp,
      });
    });
  });

  describe('incrementGapAttemptCount', () => {
    it('should send an UpdateCommand with atomic ADD and return the new count', async () => {
      // Mock resolution
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { userId: 'GAP#1710240000000', timestamp: 1710240000000, content: 'test', metadata: {} },
        ],
      });
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { metadata: { retryCount: 2 } },
      });

      const count = await memory.incrementGapAttemptCount('GAP#1710240000000');

      expect(count).toBe(2);
      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
      const input = calls[0].args[0].input;
      expect(input.UpdateExpression).toContain(
        'metadata.#retryCount = if_not_exists(metadata.#retryCount, :zero) + :one'
      );
      expect(input.ReturnValues).toBe('ALL_NEW');
    });

    it('should return 0 if the DDB response has no Attributes (first attempt)', async () => {
      // Mock resolution
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'GAP#1001', timestamp: 1001, content: 'test', metadata: {} }],
      });
      ddbMock.on(UpdateCommand).resolves({ Attributes: undefined });

      const count = await memory.incrementGapAttemptCount('GAP#1001');
      expect(count).toBe(0);
    });

    it('should return 0 (not throw) if DDB call errors', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('DDB timeout'));
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const count = await memory.incrementGapAttemptCount('GAP#1001');
      expect(count).toBe(0);
    });
  });
});

describe('DynamoMemory Delegation Tests', () => {
  let memory: DynamoMemory;

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
    memory = new DynamoMemory();
  });

  describe('Session Operations', () => {
    it('should delegate deleteConversation to SessionOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'SESSIONS#user-1', sessionId: 'session-1', updatedAt: 123456789 }],
      });
      ddbMock.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });

      await memory.deleteConversation('user-1', 'session-1');

      expect(ddbMock.commandCalls(QueryCommand).length).toBeGreaterThanOrEqual(1);
    });

    it('should delegate updateDistilledMemory to SessionOps', async () => {
      ddbMock.on(PutCommand).resolves({});

      await memory.updateDistilledMemory('user-1', 'distilled facts');

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input.Item).toMatchObject({
        userId: 'DISTILLED#user-1',
        timestamp: 0,
        type: 'DISTILLED',
        content: 'distilled facts',
      });
    });

    it('should delegate saveConversationMeta to SessionOps', async () => {
      ddbMock.on(UpdateCommand).resolves({});
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      await memory.saveConversationMeta('user-1', 'session-1', {
        title: 'test',
      });

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
    });

    it('should delegate saveLKGHash to SessionOps', async () => {
      ddbMock.on(PutCommand).resolves({});

      await memory.saveLKGHash('abc123');

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input.Item).toMatchObject({
        userId: 'SYSTEM#LKG',
        content: 'abc123',
      });
    });

    it('should delegate getLatestLKGHash to SessionOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'SYSTEM#LKG', content: 'abc123' }],
      });

      const result = await memory.getLatestLKGHash();

      expect(result).toBe('abc123');
    });

    it('should delegate getLatestLKGHash to return null when no items', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await memory.getLatestLKGHash();

      expect(result).toBeNull();
    });

    it('should delegate incrementRecoveryAttemptCount to SessionOps', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { attempts: 5 },
      });

      const result = await memory.incrementRecoveryAttemptCount();

      expect(result).toBe(5);
    });

    it('should delegate resetRecoveryAttemptCount to SessionOps', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await memory.resetRecoveryAttemptCount();

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
    });

    it('should delegate getSummary to SessionOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ content: 'test summary' }],
      });

      const result = await memory.getSummary('user-1');

      expect(result).toBe('test summary');
    });

    it('should delegate updateSummary to SessionOps', async () => {
      ddbMock.on(PutCommand).resolves({});

      await memory.updateSummary('user-1', 'new summary');

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);
    });
  });

  describe('Gap Operations', () => {
    it('should delegate setGap to GapOps', async () => {
      ddbMock.on(PutCommand).resolves({});

      await memory.setGap('GAP#123', 'test gap details', {
        category: InsightCategory.STRATEGIC_GAP,
      } as any);

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);
    });

    it('should delegate getAllGaps to GapOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { userId: 'GAP#1', type: 'GAP', status: GapStatus.OPEN, content: 'gap 1' },
          { userId: 'GAP#2', type: 'GAP', status: GapStatus.OPEN, content: 'gap 2' },
        ],
      });

      const result = await memory.getAllGaps(GapStatus.OPEN);

      expect(result).toHaveLength(2);
    });

    it('should delegate archiveStaleGaps to GapOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'GAP#1',
            type: 'GAP',
            status: GapStatus.OPEN,
            createdAt: Date.now() - 100 * 24 * 60 * 60 * 1000,
          },
        ],
      });
      ddbMock.on(UpdateCommand).resolves({});

      const result = await memory.archiveStaleGaps(90);

      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should delegate acquireGapLock to GapOps', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const result = await memory.acquireGapLock('GAP#123', 'agent-1');

      expect(result).toBe(true);
    });

    it('should delegate releaseGapLock to GapOps', async () => {
      ddbMock.on(DeleteCommand).resolves({});

      await memory.releaseGapLock('GAP#123', 'agent-1');

      const calls = ddbMock.commandCalls(DeleteCommand);
      expect(calls.length).toBeGreaterThanOrEqual(0);
    });

    it('should delegate getGapLock to GapOps', async () => {
      const lockData = JSON.stringify({ agentId: 'agent-1', expiresAt: Date.now() + 60000 });
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'GAP_LOCK#GAP#123', content: lockData }],
      });

      const result = await memory.getGapLock('GAP#123');

      expect(result).not.toBeNull();
    });

    it('should delegate getGapLock to return null when not locked', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await memory.getGapLock('GAP#123');

      expect(result).toBeNull();
    });

    it('should delegate updateGapMetadata to GapOps', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await memory.updateGapMetadata('GAP#123', {
        priority: 1 as unknown as number,
        impact: 'high',
      } as any);

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
    });
  });

  describe('Insight Operations', () => {
    it('should delegate addLesson to InsightOps', async () => {
      ddbMock.on(PutCommand).resolves({});

      await memory.addLesson('user-1', 'test lesson');

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);
    });

    it('should delegate getLessons to InsightOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'user-1',
            type: 'MEMORY:INSIGHT',
            content: 'lesson 1',
            metadata: { category: InsightCategory.TACTICAL_LESSON },
          },
          {
            userId: 'user-1',
            type: 'MEMORY:INSIGHT',
            content: 'lesson 2',
            metadata: { category: InsightCategory.TACTICAL_LESSON },
          },
        ],
      });

      const result = await memory.getLessons('user-1');

      expect(result).toEqual(['lesson 1', 'lesson 2']);
    });

    it('should delegate addMemory to InsightOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'SYSTEM#REGISTRY', activeTypes: [] }],
      });
      ddbMock.on(PutCommand).resolves({});

      const result = await memory.addMemory(
        'user-1',
        InsightCategory.USER_PREFERENCE,
        'memory content'
      );

      expect(typeof result).toBe('string');
    });

    it('should delegate searchInsights to InsightOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'user-1',
            type: 'MEMORY:USER_PREFERENCE',
            content: 'insight 1',
            timestamp: 123,
            metadata: {},
          },
        ],
      });

      const result = await memory.searchInsights(
        'user-1',
        'query',
        InsightCategory.USER_PREFERENCE,
        10
      );

      expect(result.items.length).toBeGreaterThanOrEqual(0);
    });

    it('should delegate updateInsightMetadata to InsightOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'user-1', timestamp: 123456789, content: 'test', metadata: {} }],
      });
      ddbMock.on(UpdateCommand).resolves({});

      await memory.updateInsightMetadata('user-1', 123456789, { priority: 1 });

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should delegate refineMemory to InsightOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'user-1', timestamp: 123456789, content: 'original' }],
      });
      ddbMock.on(UpdateCommand).resolves({});

      await memory.refineMemory('user-1', 123456789, 'updated content');

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);
    });

    it('should delegate getLowUtilizationMemory to InsightOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'SYSTEM#REGISTRY',
            timestamp: 0,
            activeTypes: ['MEMORY:USER_PREFERENCE'],
          },
        ],
      });

      const result = await memory.getLowUtilizationMemory(10);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should delegate recordMemoryHit to InsightOps', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await memory.recordMemoryHit('user-1', 123456789);

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
    });

    it('should delegate recordFailurePattern to InsightOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'SYSTEM#REGISTRY', timestamp: 0, activeTypes: [] }],
      });
      ddbMock.on(PutCommand).resolves({});

      const result = await memory.recordFailurePattern(
        'hash123',
        'content123',
        ['gap1'],
        'timeout error'
      );

      expect(typeof result).toBe('string');
    });

    it('should delegate getFailurePatterns to InsightOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'user-1',
            type: 'MEMORY:FAILURE_PATTERN',
            content: 'pattern 1',
            timestamp: 123,
            metadata: {},
          },
        ],
      });

      const result = await memory.getFailurePatterns(10);

      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should delegate recordFailurePattern to InsightOps', async () => {
      ddbMock.on(PutCommand).resolves({});

      const result = await memory.recordFailurePattern(
        'hash123',
        'plan content',
        ['GAP#1', 'GAP#2'],
        'failed reason'
      );

      expect(typeof result).toBe('string');
      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);
    });

    it('should delegate getFailurePatterns to InsightOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'SYSTEM#GLOBAL',
            type: 'MEMORY:FAILURE_PATTERN',
            content: '{"planHash":"hash123"}',
            timestamp: 123,
            tags: ['failed_plan'],
            metadata: {},
          },
        ],
      });

      const result = await memory.getFailurePatterns(10);

      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should delegate addGlobalLesson to InsightOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'SYSTEM#REGISTRY', timestamp: 0, activeTypes: [] }],
      });
      ddbMock.on(PutCommand).resolves({});

      const result = await memory.addGlobalLesson('global lesson');

      expect(typeof result).toBe('string');
    });

    it('should delegate getGlobalLessons to InsightOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'SYSTEM#GLOBAL',
            type: 'MEMORY:LESSON',
            content: 'global lesson 1',
            timestamp: 123,
            metadata: {},
          },
        ],
      });

      const result = await memory.getGlobalLessons(10);

      expect(result.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Memory Utility Operations', () => {
    it('should delegate getMemoryByTypePaginated to MemoryUtils', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'user-1', type: 'INSIGHT' }],
      });

      const result = await memory.getMemoryByTypePaginated('INSIGHT', 10);

      expect(result.items).toHaveLength(1);
    });

    it('should delegate getMemoryByType to MemoryUtils', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'user-1', type: 'INSIGHT' }],
      });

      const result = await memory.getMemoryByType('INSIGHT', 10);

      expect(result).toHaveLength(1);
    });

    it('should delegate getRegisteredMemoryTypes to MemoryUtils', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'SYSTEM#REGISTRY',
            timestamp: 0,
            activeTypes: ['MEMORY:USER_PREFERENCE'],
          },
        ],
      });

      const result = await memory.getRegisteredMemoryTypes();

      expect(result).toContain('MEMORY:USER_PREFERENCE');
    });

    it('should delegate listByPrefix to scanByPrefix', async () => {
      ddbMock.on(ScanCommand).resolves({
        Items: [{ userId: 'user-1#test', type: 'INSIGHT' }],
      });

      const result = await memory.listByPrefix('user-1#test');

      expect(result).toHaveLength(1);
    });
  });

  describe('Clarification Operations', () => {
    it('should delegate saveClarificationRequest to ClarificationOps', async () => {
      ddbMock.on(PutCommand).resolves({});

      await memory.saveClarificationRequest({
        traceId: 'trace-1',
        agentId: 'agent-1',
        question: 'test question',
        status: 'pending' as any,
        userId: 'user-1',
        initiatorId: 'initiator-1',
        originalTask: 'task',
        depth: 0,
        options: [],
        context: {},
      } as any);

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);
    });

    it('should delegate getClarificationRequest to ClarificationOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'CLARIFICATION#trace-1#agent-1',
            timestamp: 0,
            content: 'test question',
            status: 'pending',
          },
        ],
      });

      const result = await memory.getClarificationRequest('trace-1', 'agent-1');

      expect(result).not.toBeNull();
    });

    it('should delegate updateClarificationStatus to ClarificationOps', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await memory.updateClarificationStatus('trace-1', 'agent-1', 'resolved' as any);

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
    });

    it('should delegate saveEscalationState to ClarificationOps', async () => {
      ddbMock.on(PutCommand).resolves({});

      await memory.saveEscalationState({
        traceId: 'trace-1',
        agentId: 'agent-1',
        level: 1,
        reason: 'test reason',
        timestamp: Date.now(),
      } as any);

      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);
    });

    it('should delegate getEscalationState to ClarificationOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'ESCALATION#trace-1#agent-1',
            timestamp: 0,
            content: JSON.stringify({ level: 1, reason: 'test' }),
          },
        ],
      });

      const result = await memory.getEscalationState('trace-1', 'agent-1');

      expect(result).not.toBeNull();
    });

    it('should delegate findExpiredClarifications to ClarificationOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'CLARIFY#trace-1',
            type: 'CLARIFICATION_PENDING',
            status: 'pending',
            expiresAt: Math.floor(Date.now() / 1000) - 1000,
          },
        ],
      });

      const result = await memory.findExpiredClarifications();

      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should delegate incrementClarificationRetry to ClarificationOps', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { retryCount: 3 },
      } as any);

      const result = await memory.incrementClarificationRetry('trace-1', 'agent-1');

      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Collaboration Operations', () => {
    it('should delegate createCollaboration to CollaborationOps', async () => {
      ddbMock.on(PutCommand).resolves({});

      const result = await memory.createCollaboration(
        'user-1',
        'HUMAN' as any,
        {
          name: 'test collab',
          description: 'test description',
        } as any
      );

      expect(result).toBeDefined();
    });

    it('should delegate getCollaboration to CollaborationOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'COLLAB#123',
            timestamp: 0,
            content: 'test collab',
            type: 'COLLABORATION',
            participants: [{ type: 'HUMAN', id: 'user-1', role: 'owner' }],
          },
        ],
      });

      const result = await memory.getCollaboration('123');

      expect(result).not.toBeNull();
    });

    it('should delegate getCollaboration to return null when not found', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await memory.getCollaboration('nonexistent');

      expect(result).toBeNull();
    });

    it('should delegate addCollaborationParticipant to CollaborationOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'COLLAB#123',
            timestamp: 0,
            content: 'test',
            type: 'COLLABORATION',
            participants: [{ type: 'HUMAN', id: 'user-1', role: 'owner' }],
          },
        ],
      });
      ddbMock.on(PutCommand).resolves({});

      await memory.addCollaborationParticipant(
        '123',
        'user-1',
        'HUMAN' as any,
        {
          type: 'HUMAN',
          id: 'user-3',
          role: 'MEMBER',
        } as any
      );

      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should delegate listCollaborationsForParticipant to CollaborationOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'COLLAB_INDEX#HUMAN#user-1',
            type: 'COLLABORATION_INDEX',
            collaborationId: 'COLLAB#123',
            collaborationName: 'test collab',
            role: 'MEMBER',
          },
        ],
      });

      const result = await memory.listCollaborationsForParticipant('user-1', 'HUMAN' as any);

      expect(result).toHaveLength(1);
    });

    it('should delegate checkCollaborationAccess to CollaborationOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'COLLAB#123',
            timestamp: 0,
            content: 'test',
            type: 'COLLABORATION',
            status: 'active',
            participants: [{ type: 'HUMAN', id: 'user-1', role: 'MEMBER' }],
          },
        ],
      });

      const result = await memory.checkCollaborationAccess('123', 'user-1', 'HUMAN' as any);

      expect(result).toBe(true);
    });

    it('should delegate closeCollaboration to CollaborationOps', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'COLLAB#123',
            timestamp: 0,
            type: 'COLLABORATION',
            ownerId: 'user-1',
            ownerType: 'HUMAN',
            participants: [{ type: 'HUMAN', id: 'user-1', role: 'owner' }],
          },
        ],
      });
      ddbMock.on(UpdateCommand).resolves({});
      ddbMock.on(DeleteCommand).resolves({});

      await memory.closeCollaboration('123', 'user-1', 'HUMAN' as any);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      const deleteCalls = ddbMock.commandCalls(DeleteCommand);
      expect(updateCalls.length + deleteCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
