import { vi, describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// 1. Mock 'sst'
vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-agent-bus' },
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
    TraceTable: { name: 'test-trace-table' },
  }
}));

// 2. Mock EventBridge
const ebMock = mockClient(EventBridgeClient);

// 3. Import subject AFTER the mock
import { reportHealthIssue } from './health';
import { EventType } from './types/index';

describe('health reporting utility', () => {
  beforeEach(() => {
    ebMock.reset();
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
      const input = call.args[0].input as any;

      expect(input.Entries[0].EventBusName).toBe('test-agent-bus');
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

      // Should not throw
      await expect(reportHealthIssue(report)).resolves.not.toThrow();
      expect(ebMock.calls()).toHaveLength(1);
    });
  });
});
