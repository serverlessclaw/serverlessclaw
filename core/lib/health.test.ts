import { vi, describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { ListEventBusesCommand } from '@aws-sdk/client-eventbridge';

// 1. Mock 'sst'
vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-agent-bus' },
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
    TraceTable: { name: 'test-trace-table' },
  },
}));

// 2. Mock EventBridge and DynamoDB
const ebMock = mockClient(EventBridgeClient);
const ddbMock = mockClient(DynamoDBClient);

// 3. Import subject AFTER the mock
import { reportHealthIssue, runDeepHealthCheck } from './health';
import { EventType } from './types/index';

describe('health reporting utility', () => {
  const FIXED_NOW = 1000;

  beforeEach(() => {
    ebMock.reset();
    ddbMock.reset();
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    vi.resetModules();
  });

  describe('runDeepHealthCheck', () => {
    it('should return ok: true when all circuits pass', async () => {
      ddbMock.on(PutItemCommand).resolves({});
      ddbMock.on(GetItemCommand).resolves({
        Item: { content: { S: `PULSE#${FIXED_NOW}` } },
      });
      ddbMock.on(DeleteItemCommand).resolves({});
      ebMock.on(ListEventBusesCommand).resolves({});

      const result = await runDeepHealthCheck();
      expect(result.ok).toBe(true);
      expect(ddbMock.calls()).toHaveLength(3); // Put, Get, Delete
      expect(ebMock.commandCalls(ListEventBusesCommand)).toHaveLength(1);
    });

    it('should return ok: false if DynamoDB write fails', async () => {
      ddbMock.on(PutItemCommand).rejects(new Error('DynamoDB Write Error'));

      const result = await runDeepHealthCheck();
      expect(result.ok).toBe(false);
      expect(result.details).toContain('DynamoDB Write Error');
    });

    it('should return ok: false if pulse content mismatches', async () => {
      ddbMock.on(PutItemCommand).resolves({});
      ddbMock.on(GetItemCommand).resolves({
        Item: { content: { S: 'WRONG_PULSE' } },
      });

      const result = await runDeepHealthCheck();
      expect(result.ok).toBe(false);
      expect(result.details).toContain('content mismatch');
    });

    it('should return ok: false if EventBridge fails', async () => {
      ddbMock.on(PutItemCommand).resolves({});
      ddbMock.on(GetItemCommand).resolves({
        Item: { content: { S: `PULSE#${FIXED_NOW}` } },
      });
      ddbMock.on(DeleteItemCommand).resolves({});
      ebMock.on(ListEventBusesCommand).rejects(new Error('EventBridge Error'));

      const result = await runDeepHealthCheck();
      expect(result.ok).toBe(false);
      expect(result.details).toContain('EventBridge Error');
    });
  });

  describe('reportHealthIssue', () => {
    it('should send SYSTEM_HEALTH_REPORT event to EventBridge', async () => {
      ebMock.on(PutEventsCommand).resolves({});

      const report = {
        component: 'TestComponent',
        issue: 'Test issue description',
        severity: 'high' as const,
        userId: 'test-user-123',
        context: { detail: 'extra info' },
      };

      await reportHealthIssue(report);

      expect(ebMock.calls()).toHaveLength(1);
      const call = ebMock.call(0);
      const input = call.args[0].input as {
        Entries: Array<{
          Source: string;
          DetailType: string;
          Detail: string;
          EventBusName: string;
        }>;
      };

      expect(input.Entries[0].Source).toBe('system.health');
      expect(input.Entries[0].DetailType).toBe(EventType.SYSTEM_HEALTH_REPORT);

      const detail = JSON.parse(input.Entries[0].Detail);
      expect(detail).toMatchObject(report);
    });

    it('should log error but not throw if EventBridge fails', async () => {
      ebMock.on(PutEventsCommand).rejects(new Error('EventBridge failure'));

      const report = {
        component: 'TestComponent',
        issue: 'Test issue description',
        severity: 'low' as const,
        userId: 'test-user-123',
      };

      // Should not throw - retry logic will attempt multiple times (max 3)
      await expect(reportHealthIssue(report)).resolves.not.toThrow();
      expect(ebMock.calls().length).toBeGreaterThanOrEqual(1);
    });
  });
});
