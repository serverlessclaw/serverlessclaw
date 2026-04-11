import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../lib/types/index', () => ({
  EventType: {
    CONTINUATION_TASK: 'continuation_task',
    OUTBOUND_MESSAGE: 'outbound_message',
    TASK_COMPLETED: 'task_completed',
  },
  CompletionEvent: {},
  FailureEvent: {},
  TraceSource: { SYSTEM: 'system' },
}));

const { mockAgentStream } = vi.hoisted(() => ({
  mockAgentStream: vi.fn(),
}));

vi.mock('../../lib/agent', () => ({
  Agent: vi.fn().mockImplementation(function () {
    return {
      stream: mockAgentStream,
    };
  }),
}));

vi.mock('../../lib/utils/agent-helpers', () => ({
  getAgentContext: vi.fn().mockResolvedValue({
    memory: {},
    provider: {},
  }),
  isTaskPaused: vi.fn().mockReturnValue(false),
}));

vi.mock('../../lib/registry/index', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      id: 'test-agent',
      name: 'Test Agent',
      systemPrompt: 'prompt',
      enabled: true,
    }),
  },
}));

vi.mock('../../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

const { mockEmitTypedEvent } = vi.hoisted(() => ({
  mockEmitTypedEvent: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../lib/utils/typed-emit', () => ({
  emitTypedEvent: mockEmitTypedEvent,
}));

vi.mock('../../lib/providers/utils', () => ({
  parseConfigInt: vi.fn((val: unknown, fallback: number) => {
    const parsed = Number(val);
    return isNaN(parsed) ? fallback : parsed;
  }),
}));

vi.mock('../../lib/constants', () => ({
  SYSTEM: { DEFAULT_RECURSION_LIMIT: 15 },
  DYNAMO_KEYS: { RECURSION_LIMIT: 'recursion_limit' },
}));

vi.mock('../../lib/types/llm', () => ({
  LLMProvider: {
    OPENAI: 'openai',
    BEDROCK: 'bedrock',
    OPENROUTER: 'openrouter',
    MINIMAX: 'minimax',
  },
  MessageRole: { USER: 'user', ASSISTANT: 'assistant' },
  AttachmentType: {},
}));

vi.mock('../../lib/types/agent', () => ({
  AgentType: { FACILITATOR: 'facilitator', SUPERCLAW: 'superclaw' },
  Attachment: {},
}));

const { mockAcquireProcessing, mockReleaseProcessing, mockRenewProcessing, mockAddPendingMessage } =
  vi.hoisted(() => ({
    mockAcquireProcessing: vi.fn().mockResolvedValue(true),
    mockReleaseProcessing: vi.fn().mockResolvedValue(undefined),
    mockRenewProcessing: vi.fn().mockResolvedValue(true),
    mockAddPendingMessage: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock('../../lib/session/session-state', () => ({
  SessionStateManager: class {
    acquireProcessing = mockAcquireProcessing;
    releaseProcessing = mockReleaseProcessing;
    renewProcessing = mockRenewProcessing;
    addPendingMessage = mockAddPendingMessage;
  },
}));

vi.stubGlobal(
  'setInterval',
  vi.fn((cb) => cb())
); // Immediate execution for testing
vi.stubGlobal('clearInterval', vi.fn());

vi.mock('../../lib/types/tool', () => ({
  ITool: {},
}));

import {
  wakeupInitiator,
  getRecursionLimit,
  handleRecursionLimitExceeded,
  processEventWithAgent,
} from './shared';
import { emitEvent } from '../../lib/utils/bus';
import { sendOutboundMessage } from '../../lib/outbound';
import { ConfigManager } from '../../lib/registry/config';
import { EventType } from '../../lib/types/index';
import { emitTypedEvent } from '../../lib/utils/typed-emit';

describe('shared event utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('wakeupInitiator', () => {
    it('should emit CONTINUATION_TASK event for agents', async () => {
      await wakeupInitiator('user1', 'strategic-planner', 'review task', 'trace-1', 'sess-1', 0);
      expect(emitEvent).toHaveBeenCalledWith(
        'events.handler',
        EventType.CONTINUATION_TASK,
        expect.objectContaining({
          userId: 'user1',
          agentId: 'strategic-planner',
          task: 'review task',
          traceId: 'trace-1',
          taskId: 'trace-1', // Default taskId is traceId
          sessionId: 'sess-1',
          depth: 1,
        })
      );
    });

    it('should propagate explicit taskId and eventType', async () => {
      await wakeupInitiator(
        'user1',
        'researcher',
        'summary',
        'trace-1',
        'sess-1',
        0,
        false,
        undefined,
        'explicit-task-id',
        'research_task'
      );
      expect(emitEvent).toHaveBeenCalledWith(
        'events.handler',
        'research_task',
        expect.objectContaining({
          agentId: 'researcher',
          traceId: 'trace-1',
          taskId: 'explicit-task-id',
        })
      );
    });

    it('should send OUTBOUND_MESSAGE for human initiators', async () => {
      await wakeupInitiator('user1', 'user1', 'task done', 'trace-1', 'sess-1', 0);
      expect(sendOutboundMessage).toHaveBeenCalledWith(
        'wakeup-initiator',
        'user1',
        'task done',
        undefined,
        'sess-1',
        'SuperClaw',
        undefined,
        'trace-1',
        undefined
      );
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('should strip .agent suffix from initiatorId', async () => {
      await wakeupInitiator('user1', 'coder', 'task', undefined, undefined, 0);
      expect(emitEvent).toHaveBeenCalledWith(
        'events.handler',
        expect.anything(),
        expect.objectContaining({ agentId: 'coder' })
      );
    });

    it('should not emit if initiatorId is undefined', async () => {
      await wakeupInitiator('user1', undefined, 'task', undefined, undefined, 0);
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('should not emit if task is empty', async () => {
      await wakeupInitiator('user1', 'strategic-planner', '', undefined, undefined, 0);
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('should append USER_ALREADY_NOTIFIED marker when userNotified is true', async () => {
      await wakeupInitiator('user1', 'strategic-planner', 'task', undefined, undefined, 0, true);
      expect(emitEvent).toHaveBeenCalledWith(
        'events.handler',
        expect.anything(),
        expect.objectContaining({
          task: expect.stringContaining('USER_ALREADY_NOTIFIED: true'),
        })
      );
    });

    it('should increment depth', async () => {
      await wakeupInitiator('user1', 'strategic-planner', 'task', undefined, undefined, 5);
      expect(emitEvent).toHaveBeenCalledWith(
        'events.handler',
        expect.anything(),
        expect.objectContaining({ depth: 6 })
      );
    });

    it('should handle recursion limit exceeded and not emit event', async () => {
      // Setup: Mock recursion limit to 5, and current depth is 5
      (ConfigManager.getRawConfig as any).mockResolvedValueOnce(5);

      await wakeupInitiator('user1', 'strategic-planner', 'task', 'trace-1', 'sess-1', 5);

      expect(emitEvent).not.toHaveBeenCalled();
      expect(sendOutboundMessage).toHaveBeenCalledWith(
        'wakeup-initiator',
        'user1',
        expect.stringContaining('Recursion Limit Exceeded'),
        undefined,
        'sess-1',
        'SuperClaw',
        undefined,
        'trace-1'
      );
    });

    it('should detect dashboard-user as human initiator', async () => {
      await wakeupInitiator('user1', 'dashboard-user', 'task', undefined, undefined, 0);
      expect(sendOutboundMessage).toHaveBeenCalled();
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('should detect numeric string as human initiator', async () => {
      await wakeupInitiator('12345', '12345', 'task', undefined, undefined, 0);
      expect(sendOutboundMessage).toHaveBeenCalled();
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('should pass options to emitEvent', async () => {
      const opts = [{ label: 'Accept', value: 'accept', type: 'primary' as const }];
      await wakeupInitiator('user1', 'coder', 'task', 'trace-1', 'sess-1', 0, false, opts);
      expect(emitEvent).toHaveBeenCalledWith(
        'events.handler',
        expect.anything(),
        expect.objectContaining({ options: opts })
      );
    });
  });

  describe('getRecursionLimit', () => {
    it('should return default limit when config not set', async () => {
      (ConfigManager.getRawConfig as any).mockResolvedValueOnce(undefined);
      const result = await getRecursionLimit();
      expect(result).toBe(15);
    });

    it('should return custom limit from config', async () => {
      (ConfigManager.getRawConfig as any).mockResolvedValueOnce(25);
      const result = await getRecursionLimit();
      expect(result).toBe(25);
    });

    it('should return default on error', async () => {
      (ConfigManager.getRawConfig as any).mockRejectedValueOnce(new Error('DB error'));
      const result = await getRecursionLimit();
      expect(result).toBe(15);
    });
  });

  describe('handleRecursionLimitExceeded', () => {
    it('should send outbound message with recursion warning', async () => {
      await handleRecursionLimitExceeded('user1', 'sess-1', 'test.handler', 'Too deep');
      expect(sendOutboundMessage).toHaveBeenCalledWith(
        'test.handler',
        'user1',
        expect.stringContaining('Recursion Limit Exceeded'),
        undefined,
        'sess-1',
        'SuperClaw',
        undefined,
        undefined
      );
    });

    it('should include the reason in the message', async () => {
      await handleRecursionLimitExceeded('user1', undefined, 'handler', 'Max depth 15 reached');
      const call = (sendOutboundMessage as any).mock.calls[0];
      expect(call[2]).toContain('Max depth 15 reached');
    });
  });

  describe('processEventWithAgent', () => {
    it('should emit TASK_COMPLETED when initiator is another agent', async () => {
      const mockStream = async function* () {
        yield { content: 'test response' };
      };
      (mockAgentStream as any).mockReturnValue(mockStream());

      await processEventWithAgent('user1', 'test-agent', 'test task', {
        context: {} as any,
        initiatorId: 'strategic-planner',
        traceId: 'trace-1',
        taskId: 'task-1',
        handlerTitle: 'TEST',
        outboundHandlerName: 'test-handler',
      });

      expect(emitTypedEvent).toHaveBeenCalledWith(
        'test-agent',
        EventType.TASK_COMPLETED,
        expect.objectContaining({
          agentId: 'test-agent',
          task: 'test task',
          response: 'test response',
          initiatorId: 'strategic-planner',
          taskId: 'task-1',
        })
      );
    });

    it('should NOT emit TASK_COMPLETED when initiator is the user', async () => {
      const mockStream = async function* () {
        yield { content: 'test response' };
      };
      (mockAgentStream as any).mockReturnValue(mockStream());

      await processEventWithAgent('user1', 'test-agent', 'test task', {
        context: {} as any,
        initiatorId: 'user1',
        traceId: 'trace-1',
        handlerTitle: 'TEST',
        outboundHandlerName: 'test-handler',
      });

      expect(emitTypedEvent).not.toHaveBeenCalled();
    });

    it('should NOT emit TASK_COMPLETED when initiator is orchestrator', async () => {
      const mockStream = async function* () {
        yield { content: 'test response' };
      };
      (mockAgentStream as any).mockReturnValue(mockStream());

      await processEventWithAgent('user1', 'test-agent', 'test task', {
        context: {} as any,
        initiatorId: 'orchestrator',
        traceId: 'trace-1',
        handlerTitle: 'TEST',
        outboundHandlerName: 'test-handler',
      });

      expect(emitTypedEvent).not.toHaveBeenCalled();
    });

    it('should start heartbeat interval when sessionId is provided', async () => {
      const mockStream = async function* () {
        yield { content: 'done' };
      };
      (mockAgentStream as any).mockReturnValue(mockStream());
      mockAcquireProcessing.mockResolvedValue(true);

      await processEventWithAgent('user1', 'test-agent', 'task', {
        context: {} as any,
        sessionId: 'session-heartbeat',
        handlerTitle: 'TEST',
        outboundHandlerName: 'test-handler',
      });

      expect(mockRenewProcessing).toHaveBeenCalledWith(
        'session-heartbeat',
        expect.stringContaining('test-agent')
      );
      expect(global.clearInterval).toHaveBeenCalled();
    });

    it('should queue message and return early when session is busy', async () => {
      mockAcquireProcessing.mockResolvedValueOnce(false);

      const result = await processEventWithAgent('user1', 'test-agent', 'task content', {
        context: {} as any,
        sessionId: 'session-busy',
        handlerTitle: 'BUSY_TEST',
        outboundHandlerName: 'test-handler',
      });

      expect(mockAddPendingMessage).toHaveBeenCalledWith(
        'session-busy',
        'BUSY_TEST: task content',
        undefined
      );
      expect(result.responseText).toContain('[QUEUED]');
      expect(mockAgentStream).not.toHaveBeenCalled();
    });
  });
});
