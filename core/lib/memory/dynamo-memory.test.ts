import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoMemory } from './dynamo-memory';
import { GapStatus } from '../types/agent';
import { MessageRole } from '../types/llm';
import { AgentRegistry } from '../registry';

// Mock AgentRegistry
vi.mock('../registry', () => ({
  AgentRegistry: {
    getRetentionDays: vi.fn(),
  },
}));

// Mock SST Resource
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

    await memory.addMessage('user-1', { role: MessageRole.USER, content: 'hi' });

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
        ConditionExpression: 'attribute_exists(userId) AND #status = :expectedStatus',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': GapStatus.PLANNED,
          ':now': now,
          ':expectedStatus': GapStatus.OPEN,
        },
      });
      vi.useRealTimers();
    });

    it('should return early on ConditionalCheckFailedException for atomic transitions', async () => {
      const timestamp = 1710240000000;
      const gapId = `GAP#${timestamp}`;

      // First call fails with ConditionalCheckFailedException
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejectsOnce(error).resolves({});

      // With atomic transitions (A4), ConditionalCheckFailedException means the
      // status transition is invalid (e.g., trying to OPEN→PROGRESS but
      // gap is already in PROGRESS). The function returns early instead of throwing.
      await expect(memory.updateGapStatus(gapId, GapStatus.PROGRESS)).resolves.toBeUndefined();

      // Should have only 1 UpdateCommand call (no retry)
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls).toHaveLength(1);
    });

    it('should handle gapId that is not a numeric timestamp by searching all gaps', async () => {
      const gapId = 'GAP#some-unique-string';
      const actualTimestamp = 123456789;

      const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
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
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { attemptCount: 2 },
      });

      const count = await memory.incrementGapAttemptCount('GAP#1710240000000');

      expect(count).toBe(2);
      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toMatchObject({
        UpdateExpression:
          'SET attemptCount = if_not_exists(attemptCount, :zero) + :one, updatedAt = :now, lastAttemptTime = :now',
        ReturnValues: 'ALL_NEW',
      });
    });

    it('should return 1 if the DDB response has no Attributes (first attempt)', async () => {
      ddbMock.on(UpdateCommand).resolves({ Attributes: undefined });

      const count = await memory.incrementGapAttemptCount('GAP#1001');
      expect(count).toBe(1);
    });

    it('should return 1 (not throw) if DDB call errors', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('DDB timeout'));

      const count = await memory.incrementGapAttemptCount('GAP#1001');
      expect(count).toBe(1);
    });
  });
});
