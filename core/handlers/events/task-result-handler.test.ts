import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock 'sst'
vi.mock('sst', () => ({
  Resource: new Proxy(
    {},
    {
      get: (_target, prop) => {
        return {
          name: `test-${String(prop).toLowerCase()}`,
          value: 'test-value',
        };
      },
    }
  ),
}));

// 2. Mock AgentBus / EventBridge
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn().mockImplementation(function () {
    return { send: mockSend };
  }),
  PutEventsCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
}));

// 3. Mock Outbound
vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue({}),
}));

// 4. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// 5. Mock Registry / Config
vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockResolvedValue('50'),
  },
}));

// 6. Import code to test
import { handleTaskResult } from './task-result-handler';
import { EventType } from '../../lib/types/agent';

describe('task-result-handler (Direct Voice Flow)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should include USER_ALREADY_NOTIFIED marker in continuation task when userNotified is true', async () => {
    const eventDetail = {
      userId: 'user-123',
      agentId: 'planner',
      task: 'Analyze architecture',
      response: 'The architecture is serverless...',
      initiatorId: 'superclaw',
      depth: 1,
      sessionId: 'session-456',
      userNotified: true,
    };

    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);

    // Verify EventBridge emission (wakeupInitiator)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Entries: [
            expect.objectContaining({
              DetailType: EventType.CONTINUATION_TASK,
              Detail: expect.stringContaining('(USER_ALREADY_NOTIFIED: true)'),
            }),
          ],
        }),
      })
    );
  });

  it('should NOT include USER_ALREADY_NOTIFIED marker when userNotified is false or missing', async () => {
    const eventDetail = {
      userId: 'user-123',
      agentId: 'coder',
      task: 'Fix bug',
      response: 'Bug fixed',
      initiatorId: 'superclaw',
      depth: 1,
      sessionId: 'session-456',
      // userNotified missing
    };

    await handleTaskResult(eventDetail, EventType.TASK_COMPLETED);

    // Verify marker is ABSENT
    const callDetail = JSON.parse(mockSend.mock.calls[0][0].input.Entries[0].Detail);
    expect(callDetail.task).not.toContain('(USER_ALREADY_NOTIFIED: true)');
    expect(callDetail.task).toContain('DELEGATED_TASK_RESULT');
  });

  it('should propagate userNotified flag through task failure events', async () => {
    const eventDetail = {
      userId: 'user-123',
      agentId: 'planner',
      task: 'Complex audit',
      error: 'Simulated failure',
      initiatorId: 'superclaw',
      depth: 1,
      userNotified: true,
    };

    await handleTaskResult(eventDetail, EventType.TASK_FAILED);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Entries: [
            expect.objectContaining({
              Detail: expect.stringContaining('(USER_ALREADY_NOTIFIED: true)'),
            }),
          ],
        }),
      })
    );
  });
});
