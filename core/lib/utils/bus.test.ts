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
    it('should detect duplicate events', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [{ userId: 'IDEMPOTENCY#key' }],
      });

      const result = await emitEvent('test', 'event', { data: 'test' }, { idempotencyKey: 'key' });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('DUPLICATE');
    });

    it('should proceed if idempotency check fails', async () => {
      ddbMock.on(QueryCommand).rejects(new Error('DDB Down'));
      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'id-1' }],
      });

      const result = await emitEvent('test', 'event', { data: 'test' }, { idempotencyKey: 'key' });

      expect(result.success).toBe(true);
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
      expect(eventBridgeMock.calls()).toHaveLength(1);
      expect(ddbMock.calls()).toHaveLength(1); // One DELETE call
      expect(ddbMock.call(0).args[0] instanceof DeleteCommand).toBe(true);
    });
  });
});
