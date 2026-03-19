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

describe('EventHandler - Clarification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should relay CLARIFICATION_REQUEST to initiator', async () => {
    const event = {
      'detail-type': EventType.CLARIFICATION_REQUEST,
      detail: {
        userId: 'user-1',
        agentId: 'coder',
        question: 'Should I use Tabs or Spaces?',
        originalTask: 'Implement new feature',
        initiatorId: 'planner',
        traceId: 'trace-123',
        sessionId: 'session-123',
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
              Detail: expect.stringContaining('CLARIFICATION_REQUEST'),
            }),
          ],
        }),
      })
    );

    const detail = JSON.parse(mockSend.mock.calls[0][0].input.Entries[0].Detail);
    expect(detail.agentId).toBe('planner');
    expect(detail.task).toContain('Should I use Tabs or Spaces?');
    expect(detail.task).toContain('Implement new feature');
    expect(detail.depth).toBe(2);
  });

  it('should abort if recursion limit reached for CLARIFICATION_REQUEST', async () => {
    const event = {
      'detail-type': EventType.CLARIFICATION_REQUEST,
      detail: {
        userId: 'user-1',
        agentId: 'coder',
        question: 'Infinite loop?',
        originalTask: 'Task',
        initiatorId: 'planner',
        depth: 100,
      },
    };

    await handler(event as any, {} as any);

    const { sendOutboundMessage } = await import('../lib/outbound');
    expect(sendOutboundMessage).toHaveBeenCalledWith(
      'clarification-handler',
      'user-1',
      expect.stringContaining('Recursion Limit Exceeded'),
      undefined,
      undefined,
      'SuperClaw',
      undefined
    );
  });
});
