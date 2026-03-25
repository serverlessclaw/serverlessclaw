import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock 'sst' FIRST with a proxy
vi.mock('sst', () => ({
  Resource: new Proxy(
    {},
    {
      get: (_target, prop) => {
        return {
          name: `test-${String(prop).toLowerCase()}`,
          value: 'test-value',
          url: 'http://test.com',
        };
      },
    }
  ),
}));

// Mock Agent
const mockProcess = vi.fn();
vi.mock('../lib/agent', () => {
  return {
    Agent: vi.fn(function () {
      return {
        process: mockProcess,
        stream: async function* () {
          // eslint-disable-next-line prefer-rest-params
          const result = await mockProcess.apply(this, arguments as any);
          yield { content: result.responseText };
        },
      };
    }),
  };
});

// Import local code AFTER the mocks
import { handler } from './events';
import { EventType } from '../lib/types/agent';

// Mock AgentRegistry
vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      systemPrompt: 'Test Prompt',
      name: 'SuperClaw',
    }),
    getRawConfig: vi.fn().mockResolvedValue(50),
  },
}));

// Mock tools and outbound
vi.mock('../tools', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
  TOOLS: {},
}));

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-eventbridge', () => {
  return {
    EventBridgeClient: vi.fn().mockImplementation(function () {
      return { send: mockSend };
    }),
    PutEventsCommand: vi.fn().mockImplementation(function (args) {
      return { input: args };
    }),
  };
});

vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue({}),
}));

// Mock logger
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('EventHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SYSTEM_HEALTH_REPORT', () => {
    it('should triage health report and send outbound message', async () => {
      const event = {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: {
          component: 'TestComp',
          issue: 'Out of memory',
          severity: 'critical',
          userId: 'user-1',
          traceId: 'trace-1',
          sessionId: 'session-1',
          context: { ram: '100%' },
        },
      };

      mockProcess.mockResolvedValue({ responseText: 'Rebooting component...' });

      await handler(event as any, {} as any);

      // Verify Agent.process was called with triage prompt
      expect(mockProcess).toHaveBeenCalledWith(
        'user-1',
        expect.stringContaining('HEALTH_TRIAGE'),
        expect.objectContaining({
          traceId: 'trace-1',
          sessionId: 'session-1',
          source: 'system',
        })
      );

      // Verify outbound message
      const { sendOutboundMessage } = await import('../lib/outbound');
      expect(sendOutboundMessage).toHaveBeenCalledWith(
        'health-handler',
        'user-1',
        expect.stringContaining('Rebooting component...'),
        undefined,
        'session-1',
        'SuperClaw',
        [],
        'trace-1'
      );
    });

    it('should not send outbound message if task is paused', async () => {
      const event = {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: {
          component: 'TestComp',
          issue: 'Error',
          severity: 'low',
          userId: 'user-1',
        },
      };

      mockProcess.mockResolvedValue({ responseText: 'TASK_PAUSED: Need permission' });

      await handler(event as any, {} as any);

      const { sendOutboundMessage } = await import('../lib/outbound');
      expect(sendOutboundMessage).not.toHaveBeenCalled();
    });
  });

  describe('SYSTEM_BUILD_FAILED', () => {
    it('should triage build failure and wake up initiator', async () => {
      const event = {
        'detail-type': EventType.SYSTEM_BUILD_FAILED,
        detail: {
          userId: 'user-1',
          buildId: 'build-123',
          errorLogs: 'Syntax error at line 10',
          traceId: 'trace-1',
          initiatorId: 'planner.agent',
          task: 'Improve system',
        },
      };

      mockProcess.mockResolvedValue({ responseText: 'Investigating failure...' });

      await handler(event as any, {} as any);

      // Verify Agent.process was called
      expect(mockProcess).toHaveBeenCalledWith(
        'user-1',
        expect.stringContaining('CRITICAL: Deployment build-123 failed'),
        expect.objectContaining({ traceId: 'trace-1' })
      );

      // Verify initiator wakeup
      const { EventBridgeClient } = await import('@aws-sdk/client-eventbridge');
      const eb = new EventBridgeClient({});
      expect(eb.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Entries: [
              expect.objectContaining({
                DetailType: EventType.CONTINUATION_TASK,
                Detail: expect.stringContaining('BUILD_FAILURE_NOTIFICATION'),
              }),
            ],
          }),
        })
      );
    });
  });

  describe('SYSTEM_BUILD_SUCCESS', () => {
    it('should notify success and wake up initiator', async () => {
      const event = {
        'detail-type': EventType.SYSTEM_BUILD_SUCCESS,
        detail: {
          userId: 'user-1',
          buildId: 'build-123',
          initiatorId: 'planner',
          task: 'Improve system',
          traceId: 'trace-1',
        },
      };

      await handler(event as any, {} as any);

      const { sendOutboundMessage } = await import('../lib/outbound');
      expect(sendOutboundMessage).toHaveBeenCalledWith(
        'build-handler',
        'user-1',
        expect.stringContaining('DEPLOYMENT SUCCESSFUL'),
        undefined,
        undefined,
        'SuperClaw',
        undefined
      );

      // Verify initiator wakeup
      const { EventBridgeClient } = await import('@aws-sdk/client-eventbridge');
      const eb = new EventBridgeClient({});
      expect(eb.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Entries: [
              expect.objectContaining({
                DetailType: EventType.CONTINUATION_TASK,
                Detail: expect.stringContaining('BUILD_SUCCESS_NOTIFICATION'),
              }),
            ],
          }),
        })
      );
    });
  });

  describe('TASK_COMPLETED / TASK_FAILED', () => {
    it('should relay completion to initiator', async () => {
      const event = {
        'detail-type': EventType.TASK_COMPLETED,
        detail: {
          userId: 'user-1',
          agentId: 'coder',
          task: 'Fix bug',
          response: 'Bug fixed!',
          initiatorId: 'superclaw',
          depth: 1,
        },
      };

      await handler(event as any, {} as any);

      const { EventBridgeClient } = await import('@aws-sdk/client-eventbridge');
      const eb = new EventBridgeClient({});
      expect(eb.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Entries: [
              expect.objectContaining({
                DetailType: EventType.CONTINUATION_TASK,
                Detail: expect.stringContaining('DELEGATED_TASK_RESULT'),
              }),
            ],
          }),
        })
      );
    });

    it('should relay failure to initiator', async () => {
      const event = {
        'detail-type': EventType.TASK_FAILED,
        detail: {
          userId: 'user-1',
          agentId: 'coder',
          task: 'Fix bug',
          error: 'Timeout',
          initiatorId: 'superclaw',
          depth: 1,
        },
      };

      await handler(event as any, {} as any);

      const { EventBridgeClient } = await import('@aws-sdk/client-eventbridge');
      const eb = new EventBridgeClient({});
      expect(eb.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Entries: [
              expect.objectContaining({
                DetailType: EventType.CONTINUATION_TASK,
                Detail: expect.stringContaining('DELEGATED_TASK_FAILURE'),
              }),
            ],
          }),
        })
      );
    });

    it('should abort if recursion limit reached', async () => {
      const event = {
        'detail-type': EventType.TASK_COMPLETED,
        detail: {
          userId: 'user-1',
          agentId: 'coder',
          task: 'Fix bug',
          response: 'Done',
          initiatorId: 'superclaw',
          depth: 100, // Very high
        },
      };

      await handler(event as any, {} as any);

      const { sendOutboundMessage } = await import('../lib/outbound');
      expect(sendOutboundMessage).toHaveBeenCalledWith(
        'task-result-handler',
        'user-1',
        expect.stringContaining('Recursion Limit Exceeded'),
        undefined,
        undefined,
        'SuperClaw',
        undefined
      );
    });

    it('should abort CONTINUATION_TASK if recursion limit reached', async () => {
      const event = {
        'detail-type': EventType.CONTINUATION_TASK,
        detail: {
          userId: 'user-2',
          agentId: 'superclaw',
          task: 'Continue processing',
          initiatorId: 'superclaw',
          depth: 100, // Exceeds default limit of 50
        },
      };

      await handler(event as any, {} as any);

      const { sendOutboundMessage } = await import('../lib/outbound');
      expect(sendOutboundMessage).toHaveBeenCalledWith(
        'continuation-handler',
        'user-2',
        expect.stringContaining('Recursion Limit Exceeded'),
        undefined,
        undefined,
        'SuperClaw',
        undefined
      );
    });
  });
});
