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
      };
    }),
  };
});

// Import local code AFTER the mocks
import { handler } from './events';
import { EventType } from '../lib/types/index';

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
}));

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

      mockProcess.mockResolvedValue('Rebooting component...');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        'events.handler',
        'user-1',
        expect.stringContaining('CRITICAL'),
        undefined,
        'session-1',
        'SuperClaw'
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

      mockProcess.mockResolvedValue('TASK_PAUSED: Need permission');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await handler(event as any, {} as any);

      const { sendOutboundMessage } = await import('../lib/outbound');
      expect(sendOutboundMessage).not.toHaveBeenCalled();
    });
  });
});
