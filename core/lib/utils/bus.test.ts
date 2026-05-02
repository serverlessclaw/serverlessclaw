import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsCommandInput,
} from '@aws-sdk/client-eventbridge';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  PutCommandInput,
  QueryCommandInput,
  DeleteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  emitEvent,
  EventPriority,
  emitCriticalEvent,
  emitLowPriorityEvent,
  getDlqEntries,
  retryDlqEntry,
  purgeDlqEntry,
  resetDb,
  resetEventBridge,
} from './bus';

const eventBridgeMock = mockClient(EventBridgeClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
    MemoryTable: { name: 'test-memory-table' },
  },
}));

describe('Event Bus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventBridgeMock.reset();
    ddbMock.reset();
    resetDb();
    resetEventBridge();
  });

  describe('emitEvent', () => {
    it('should emit event successfully', async () => {
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'test-event-id' }],
      });

      const result = await emitEvent('test.source', 'test.event', { data: 'test' });

      expect(result.success).toBe(true);
      expect(result.eventId).toBe('test-event-id');
    });

    it('should handle transient errors with retry', async () => {
      eventBridgeMock
        .on(PutEventsCommand)
        .rejectsOnce(new Error('Rate limit exceeded'))
        .resolvesOnce({
          FailedEntryCount: 0,
          Entries: [{ EventId: 'test-event-id' }],
        });

      const result = await emitEvent('test.source', 'test.event', { data: 'test' });

      expect(result.success).toBe(true);
      expect(eventBridgeMock.calls()).toHaveLength(2);
    });

    it('should store in DLQ after max retries', async () => {
      eventBridgeMock.on(PutEventsCommand).rejects(new Error('Service unavailable'));
      ddbMock.on(PutCommand).resolves({});

      const result = await emitEvent('test.source', 'test.event', { data: 'test' });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('DLQ');
      expect(ddbMock.calls()).toHaveLength(1);
      const input = ddbMock.call(0).args[0].input as PutCommandInput;
      expect(input.Item?.type).toBe('DLQ_EVENT');
    });

    it('should store in DLQ immediately on permanent error', async () => {
      eventBridgeMock.on(PutEventsCommand).rejects(new Error('Access Denied'));
      ddbMock.on(PutCommand).resolves({});

      const result = await emitEvent('test.source', 'test.event', { data: 'test' });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('PERMANENT_ERROR');
      expect(eventBridgeMock.calls()).toHaveLength(1); // No retries
      expect(ddbMock.calls()).toHaveLength(1); // Stored in DLQ
    });

    it('should include workspaceId in DLQ key and item when provided', async () => {
      eventBridgeMock.on(PutEventsCommand).rejects(new Error('Access Denied'));
      ddbMock.on(PutCommand).resolves({});

      await emitEvent(
        'test.source',
        'test.event',
        { data: 'test', workspaceId: 'ws-123' },
        { idempotencyKey: 'idem-1' }
      );

      expect(ddbMock.calls()).toHaveLength(2); // 1 for Idempotency Reserve, 1 for DLQ
      const dlqCall = ddbMock.calls().find((c) => {
        const input = c.args[0].input as any;
        return input.Item?.type === 'DLQ_EVENT';
      });
      expect(dlqCall).toBeDefined();
      const input = dlqCall?.args[0].input as PutCommandInput;
      expect(input.Item?.userId).toBe('WS#ws-123#EVENTBUS#DLQ#idem-1');
      expect(input.Item?.workspaceId).toBe('ws-123');
    });
  });

  describe('Convenience Helpers', () => {
    it('should emit CRITICAL priority events with custom retries', async () => {
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'critical-id' }],
      });

      await emitCriticalEvent('test', 'event', { data: 'urgent' });

      const call = eventBridgeMock.call(0);
      const input = call.args[0].input as PutEventsCommandInput;
      expect(input.Entries?.[0]?.Source).toBe('test');
    });

    it('should allow overriding retries in helpers', async () => {
      eventBridgeMock.on(PutEventsCommand).rejects(new Error('Throttling'));
      ddbMock.on(PutCommand).resolves({});

      await emitLowPriorityEvent('test', 'event', { data: 'low' }, { maxRetries: 2 });

      expect(eventBridgeMock.calls()).toHaveLength(2);
    });
  });

  describe('Idempotency', () => {
    it('should detect duplicate events using Reserve-then-Commit', async () => {
      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejects(error);

      const result = await emitEvent('test', 'event', { data: 'test' }, { idempotencyKey: 'key' });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('DUPLICATE');
      // Should have tried to Put (reserve) the key
      const call = ddbMock.call(0);
      expect(call.args[0] instanceof PutCommand).toBe(true);
      expect((call.args[0].input as PutCommandInput).Item?.userId).toBe('IDEMPOTENCY#key');
    });

    it('should commit idempotency key after successful emission', async () => {
      ddbMock.on(PutCommand).resolves({}); // Reserve
      ddbMock.on(UpdateCommand).resolves({}); // Commit
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'id-1' }],
      });

      const result = await emitEvent('test', 'event', { data: 'test' }, { idempotencyKey: 'key' });

      expect(result.success).toBe(true);
      expect(ddbMock.calls()).toHaveLength(2); // 1 Reserve (Put) + 1 Commit (Update)

      const reserveCall = ddbMock.call(0).args[0].input as PutCommandInput;
      expect(reserveCall.Item?.status).toBe('RESERVED');

      const commitCall = ddbMock.call(1).args[0].input as any;
      expect(commitCall.UpdateExpression).toContain(':committed');
      expect(commitCall.ExpressionAttributeValues?.[':eventId']).toBe('id-1');
    });

    it('should block event if idempotency reservation fails with non-conditional error', async () => {
      ddbMock.on(PutCommand).rejects(new Error('DDB Down'));
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'id-1' }],
      });

      const result = await emitEvent('test', 'event', { data: 'test' }, { idempotencyKey: 'key' });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('DUPLICATE');
    });
  });

  describe('DLQ operations', () => {
    it('should get DLQ entries using GSI', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          {
            userId: 'DLQ#test#123',
            timestamp: 123,
            type: 'DLQ_EVENT',
            source: 'test.source',
            detailType: 'test.event',
            detail: '{"data":"test"}',
            retryCount: 3,
            maxRetries: 3,
            priority: EventPriority.NORMAL,
          },
        ],
      });

      const entries = await getDlqEntries();

      expect(entries.length).toBe(1);
      const input = ddbMock.call(0).args[0].input as QueryCommandInput;
      expect(input.IndexName).toBe('TypeTimestampIndex');
      expect(input.ExpressionAttributeValues?.[':type']).toBe('DLQ_EVENT');
    });

    it('should filter DLQ entries by workspaceId', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { userId: 'DLQ#1', workspaceId: 'ws-1', type: 'DLQ_EVENT' },
          { userId: 'DLQ#2', workspaceId: 'ws-2', type: 'DLQ_EVENT' },
          { userId: 'DLQ#3', workspaceId: 'ws-1', type: 'DLQ_EVENT' },
        ],
      });

      const entries = await getDlqEntries({ workspaceId: 'ws-1' });

      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.workspaceId === 'ws-1')).toBe(true);
    });

    it('should purge DLQ entry', async () => {
      ddbMock.on(DeleteCommand).resolves({});

      await purgeDlqEntry({ userId: 'DLQ#123', timestamp: 456 });

      expect(ddbMock.calls()).toHaveLength(1);
      const input = ddbMock.call(0).args[0].input as DeleteCommandInput;
      expect(input.Key).toEqual({ userId: 'DLQ#123', timestamp: 456 });
    });

    it('should retry DLQ entry and delete on success', async () => {
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'retry-id' }],
      });
      ddbMock.on(DeleteCommand).resolves({});

      const entry = {
        userId: 'DLQ#test#123',
        timestamp: 123,
        type: 'DLQ_EVENT',
        source: 'test.source',
        detailType: 'test.event',
        detail: '{"data":"test"}',
        retryCount: 3,
        maxRetries: 3,
        priority: EventPriority.NORMAL,
        createdAt: 123,
        expiresAt: 456,
      };

      const result = await retryDlqEntry(entry);

      expect(result).toBe(true);

      // Should emit first
      expect(eventBridgeMock.calls()).toHaveLength(1);

      // Should purge AFTER emit (DDB Delete)
      const deleteCall = ddbMock.calls().find((c) => c.args[0] instanceof DeleteCommand);
      expect(deleteCall).toBeDefined();
    });

    it('should purge DLQ entry if retry returns DUPLICATE (already in progress)', async () => {
      // Mock idempotency reservation failure (DUPLICATE)
      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejects(error);
      ddbMock.on(DeleteCommand).resolves({});

      const entry = {
        userId: 'DLQ#test#duplicate',
        timestamp: 999,
        type: 'DLQ_EVENT',
        source: 'test.source',
        detailType: 'test.event',
        detail: '{"data":"test"}',
        retryCount: 1,
        maxRetries: 3,
        priority: EventPriority.NORMAL,
        createdAt: 999,
        expiresAt: 1999,
      };

      const result = await retryDlqEntry(entry);

      expect(result).toBe(true); // Should return true because it's handled
      const deleteCall = ddbMock.calls().find((c) => c.args[0] instanceof DeleteCommand);
      expect(deleteCall).toBeDefined(); // Should still purge
    });
  });
});
