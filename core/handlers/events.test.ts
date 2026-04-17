import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock 'sst' FIRST with a proxy
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    AgentTable: { name: 'test-agent-table' },
    SessionTable: { name: 'test-session-table' },
  },
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

// Mock DistributedState
vi.mock('../lib/utils/distributed-state', () => ({
  DistributedState: {
    isCircuitOpen: vi.fn().mockResolvedValue(false),
    consumeToken: vi.fn().mockResolvedValue(true),
  },
}));

// Import local code AFTER the mocks
import { handler } from './events';
import { EventType } from '../lib/types/agent';

// Mock AgentRegistry
vi.mock('../lib/registry/index', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      systemPrompt: 'Test Prompt',
      name: 'SuperClaw',
    }),
    getRawConfig: vi.fn().mockResolvedValue(50),
  },
}));

// Mock ConfigManager
vi.mock('../lib/registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn(async (_key, fallback) => fallback),
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

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () {
    return {
      config: { protocol: 'https' },
      send: vi.fn(),
    };
  }),
  PutItemCommand: vi.fn(),
  GetItemCommand: vi.fn(),
  ConditionalCheckFailedException: class extends Error {
    name = 'ConditionalCheckFailedException';
  },
}));

vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue({}),
}));

// Mock recursion tracker
vi.mock('../lib/recursion-tracker', () => ({
  getRecursionDepth: vi.fn(async () => 0),
  incrementRecursionDepth: vi.fn(async () => 1),
  clearRecursionStack: vi.fn(async () => undefined),
  getRecursionLimit: vi.fn(async () => 15),
}));

// Mock logger
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock sub-handlers
vi.mock('./events/health-handler', () => ({
  handleHealthReport: vi.fn(),
}));
vi.mock('./events/build-handler', () => ({
  handleBuildFailure: vi.fn(),
  handleBuildSuccess: vi.fn(),
}));
vi.mock('./events/task-result-handler', () => ({
  handleTaskResult: vi.fn(),
}));
vi.mock('./events/continuation-handler', () => ({
  handleContinuationTask: vi.fn(),
}));
vi.mock('./events/clarification-handler', () => ({
  handleClarificationRequest: vi.fn(),
}));
vi.mock('./events/clarification-timeout-handler', () => ({
  handleClarificationTimeout: vi.fn(),
}));
vi.mock('./events/parallel-handler', () => ({
  handleParallelDispatch: vi.fn(),
}));
vi.mock('./events/dlq-handler', () => ({
  handleDlqRoute: vi.fn(),
}));
vi.mock('./events/idempotency', () => ({
  checkAndMarkIdempotent: vi.fn().mockResolvedValue(false),
}));
vi.mock('../lib/routing/flow-controller', () => ({
  FlowController: {
    canProceed: vi.fn().mockResolvedValue({ allowed: true }),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('EventHandler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const tracker = await import('../lib/recursion-tracker');
    vi.mocked(tracker.incrementRecursionDepth).mockResolvedValue(1);
    vi.mocked(tracker.getRecursionLimit).mockResolvedValue(15);
  });

  describe('Loop Regression', () => {
    it('should route non-DLQ events to DLQ once when recursion tracker fails (-1)', async () => {
      const tracker = await import('../lib/recursion-tracker');
      vi.mocked(tracker.incrementRecursionDepth).mockResolvedValueOnce(-1);

      const event = {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: {
          userId: 'u1',
          sessionId: 'test-session',
          traceId: 'trace-loop-1',
        },
      };

      await handler(event as any, {} as any);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const commandInput = mockSend.mock.calls[0][0]?.input;
      const entry = commandInput?.Entries?.[0];
      expect(entry?.DetailType).toBe(EventType.DLQ_ROUTE);

      const detail = JSON.parse(entry?.Detail ?? '{}');
      expect(detail).toMatchObject({
        detailType: EventType.SYSTEM_HEALTH_REPORT,
        traceId: 'trace-loop-1',
        sessionId: 'test-session',
      });

      const { handleHealthReport } = await import('./events/health-handler');
      expect(handleHealthReport).not.toHaveBeenCalled();
    });

    it('should not emit DLQ when processing DLQ_ROUTE event itself', async () => {
      const tracker = await import('../lib/recursion-tracker');

      const event = {
        'detail-type': EventType.DLQ_ROUTE,
        detail: {
          detailType: EventType.SYSTEM_HEALTH_REPORT,
          originalEvent: { userId: 'u1' },
          userId: 'SYSTEM',
          sessionId: 'test-session',
          traceId: 'trace-loop-2',
        },
      };

      await handler(event as any, {} as any);

      expect(mockSend).not.toHaveBeenCalled();
      expect(tracker.incrementRecursionDepth).not.toHaveBeenCalled();

      const { handleDlqRoute } = await import('./events/dlq-handler');
      expect(handleDlqRoute).toHaveBeenCalled();
    });

    it('should auto-inject missing ids on DLQ_ROUTE and still avoid recursive emit', async () => {
      const event = {
        'detail-type': EventType.DLQ_ROUTE,
        detail: {
          detailType: EventType.SYSTEM_HEALTH_REPORT,
          originalEvent: { userId: 'u1' },
        },
      };

      await handler(event as any, {} as any);

      expect(mockSend).not.toHaveBeenCalled();

      const { handleDlqRoute } = await import('./events/dlq-handler');
      expect(handleDlqRoute).toHaveBeenCalled();
      const detailArg = vi.mocked(handleDlqRoute).mock.calls[0][0] as Record<string, unknown>;
      expect(detailArg.sessionId).toBe('system-spine');
      expect(String(detailArg.traceId)).toContain('t-sys-');
    });
  });

  describe('Safe Mode Fallback', () => {
    it('should block unrecognised routing combinations', async () => {
      const tracker = await import('../lib/recursion-tracker');
      vi.mocked(tracker.incrementRecursionDepth).mockResolvedValueOnce(1);
      vi.mocked(tracker.getRecursionLimit).mockResolvedValueOnce(15);

      const { ConfigManager } = await import('../lib/registry/config');
      await import('../lib/event-routing');

      // Mock a dangerous combination
      (ConfigManager.getTypedConfig as any).mockResolvedValue({
        [EventType.SYSTEM_HEALTH_REPORT]: {
          module: 'dangerous-module',
          function: 'formatDrive',
          passContext: false,
        },
      });

      const event = {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: { userId: 'user-safe', sessionId: 'test-session', traceId: 'test-trace' },
      };

      await handler(event as any, {} as any);

      const { logger } = await import('../lib/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[SECURITY] Blocked unrecognised routing combination')
      );
    });
  });

  describe('Resiliency', () => {
    it('should inject default sessionId when missing', async () => {
      const event = {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: { traceId: 'test-trace', component: 'test', issue: 'issue', severity: 'low' },
      };
      await handler(event as any, {} as any);
      const { logger } = await import('../lib/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Missing sessionId, using default: system-spine')
      );
    });

    it('should inject default traceId when missing', async () => {
      const event = {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: { sessionId: 'test-session', component: 'test', issue: 'issue', severity: 'low' },
      };
      await handler(event as any, {} as any);
      const { logger } = await import('../lib/logger');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Missing traceId, using default: t-sys-')
      );
    });

    it('should skip recursion tracking for DLQ_ROUTE to prevent self-recursion', async () => {
      const tracker = await import('../lib/recursion-tracker');
      const event = {
        'detail-type': EventType.DLQ_ROUTE,
        detail: {
          detailType: EventType.SYSTEM_HEALTH_REPORT,
          originalEvent: { sessionId: 'test-session', traceId: 'test-trace' },
          sessionId: 'test-session',
          traceId: 'test-trace',
        },
      };

      await handler(event as any, {} as any);

      const { handleDlqRoute } = await import('./events/dlq-handler');
      expect(tracker.incrementRecursionDepth).not.toHaveBeenCalled();
      expect(handleDlqRoute).toHaveBeenCalled();
    });

    it('should include trace/session context when flow control rejects an event', async () => {
      const { FlowController } = await import('../lib/routing/flow-controller');
      vi.mocked(FlowController.canProceed).mockResolvedValueOnce({
        allowed: false,
        reason: 'rate limited',
      } as any);

      const event = {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: { userId: 'u1', sessionId: 's-flow', traceId: 't-flow' },
      };

      await handler(event as any, {} as any);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const commandInput = mockSend.mock.calls[0][0]?.input;
      const entry = commandInput?.Entries?.[0];
      const detail = JSON.parse(entry?.Detail ?? '{}');
      expect(detail).toMatchObject({
        detailType: EventType.SYSTEM_HEALTH_REPORT,
        traceId: 't-flow',
        sessionId: 's-flow',
        errorMessage: 'rate limited',
      });
    });

    it('should include trace/session context when retry count exceeds configured max', async () => {
      const { ConfigManager } = await import('../lib/registry/config');
      vi.mocked(ConfigManager.getTypedConfig).mockImplementation(
        async (key: string, fallback: unknown) => {
          if (key === 'event_max_retry_count') return 1 as any;
          if (key === 'event_routing_table') return fallback as any;
          return fallback as any;
        }
      );

      const event = {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: {
          userId: 'u1',
          sessionId: 's-retry',
          traceId: 't-retry',
          retryCount: 2,
        },
      };

      await handler(event as any, {} as any);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const commandInput = mockSend.mock.calls[0][0]?.input;
      const entry = commandInput?.Entries?.[0];
      const detail = JSON.parse(entry?.Detail ?? '{}');
      expect(detail).toMatchObject({
        detailType: EventType.SYSTEM_HEALTH_REPORT,
        traceId: 't-retry',
        sessionId: 's-retry',
        errorMessage: 'Max retry count exceeded',
      });

      vi.mocked(ConfigManager.getTypedConfig).mockImplementation(
        async (_key, fallback) => fallback
      );
    });
  });
});
