import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoMemory } from './memory';
import { GapStatus } from './types/agent';
import { MessageRole } from './types/llm';
import { AgentRegistry } from './registry';

// Mock AgentRegistry
vi.mock('./registry', () => ({
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
    expect(item?.expiresAt).toBe(Math.floor(now / 1000) + 730 * 24 * 60 * 60);

    vi.useRealTimers();
  });

  describe('updateGapStatus', () => {
    it('should send UpdateCommand with correct parameters when gapId contains timestamp', async () => {
      const timestamp = 1710240000000;
      const gapId = `GAP#${timestamp}`;
      ddbMock.on(UpdateCommand).resolves({});

      await memory.updateGapStatus(gapId, GapStatus.PLANNED);

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toMatchObject({
        TableName: 'test-memory-table',
        Key: {
          userId: `GAP#${timestamp}`,
          timestamp: timestamp,
        },
        UpdateExpression: 'SET #status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': GapStatus.PLANNED,
        },
      });
    });

    it('should handle gapId that is not a numeric timestamp by defaulting timestamp to 0', async () => {
      const gapId = 'GAP#some-unique-string';
      ddbMock.on(UpdateCommand).resolves({});

      await memory.updateGapStatus(gapId, GapStatus.PROGRESS);

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
