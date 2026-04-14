import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventType } from '../lib/types/agent';

vi.mock('sst', () => ({
  Resource: new Proxy(
    {},
    {
      get: (_target, prop) => ({
        name: `test-${String(prop).toLowerCase()}`,
        value: 'test-value',
        url: 'http://test.com',
      }),
    }
  ),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../lib/registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn(async (_key: string, fallback: unknown) => fallback),
  },
}));

vi.mock('../lib/recursion-tracker', () => ({
  getRecursionDepth: vi.fn(async () => 0),
  incrementRecursionDepth: vi.fn(async () => 1),
  clearRecursionStack: vi.fn(async () => undefined),
}));

vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue({}),
}));

const ebMocks = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
  mockEmitEvent: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: class {
    send = ebMocks.mockSend;
  },
  PutEventsCommand: vi.fn().mockImplementation((args: unknown) => ({ input: args })),
}));

vi.mock('../lib/utils/bus', () => ({
  emitEvent: ebMocks.mockEmitEvent,
  EventPriority: {
    CRITICAL: 'CRITICAL',
    HIGH: 'HIGH',
    NORMAL: 'NORMAL',
    LOW: 'LOW',
  },
}));

describe('Event Router Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ebMocks.mockSend.mockResolvedValue({});
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should route SYSTEM_BUILD_FAILED to build-handler.handleBuildFailure', async () => {
    const mockHandleBuildFailure = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./events/build-handler', () => ({
      handleBuildFailure: mockHandleBuildFailure,
    }));

    const { handler } = await import('./events');

    await handler(
      {
        'detail-type': 'system_build_failed',
        detail: {
          userId: 'user-1',
          buildId: 'build-123',
          errorLogs: 'Test error',
          traceId: 'trace-1',
          initiatorId: 'test',
          task: 'Test task',
        },
      },
      {} as any
    );

    expect(mockHandleBuildFailure).toHaveBeenCalled();

    vi.doUnmock('./events/build-handler');
  });

  it('should route SYSTEM_BUILD_SUCCESS to build-handler.handleBuildSuccess', async () => {
    const mockHandleBuildSuccess = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./events/build-handler', () => ({
      handleBuildSuccess: mockHandleBuildSuccess,
    }));

    const { handler } = await import('./events');

    await handler(
      {
        'detail-type': 'system_build_success',
        detail: {
          userId: 'user-1',
          buildId: 'build-456',
          initiatorId: 'test',
          task: 'Test task',
          traceId: 'trace-2',
        },
      },
      {} as any
    );

    expect(mockHandleBuildSuccess).toHaveBeenCalled();

    vi.doUnmock('./events/build-handler');
  });

  it('should route TASK_COMPLETED to task-result-handler.handleTaskResult', async () => {
    const mockHandleTaskResult = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./events/task-result-handler', () => ({
      handleTaskResult: mockHandleTaskResult,
    }));

    const { handler } = await import('./events');

    await handler(
      {
        'detail-type': 'task_completed',
        detail: {
          userId: 'user-1',
          agentId: 'coder',
          task: 'Fix bug',
          response: 'Fixed',
          initiatorId: 'superclaw',
          depth: 1,
          traceId: 'test-trace',
          sessionId: 'test-session',
        },
      },
      {} as any
    );

    expect(mockHandleTaskResult).toHaveBeenCalled();

    vi.doUnmock('./events/task-result-handler');
  });

  it('should route unknown event type to DLQ and resolve', async () => {
    const { handler } = await import('./events');

    // This should no longer throw, but resolve successfully as it routes to DLQ
    const result = await handler(
      {
        'detail-type': 'unknown_event_type_xyz',
        detail: { userId: 'user-1' },
      },
      {} as any
    );

    expect(result).toBeUndefined();
    // Verify it attempted to emit a DLQ event
    expect(ebMocks.mockEmitEvent).toHaveBeenCalledWith(
      'events.handler',
      EventType.DLQ_ROUTE,
      expect.objectContaining({
        eventCategory: 'dlq_routing',
        detailType: 'unknown_event_type_xyz',
      })
    );
  });

  it('should inject envelope id into detail for idempotency', async () => {
    const mockHandler = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./events/health-handler', () => ({
      handleHealthReport: mockHandler,
    }));

    const { handler } = await import('./events');

    await handler(
      {
        'detail-type': 'system_health_report',
        detail: {
          component: 'TestComp',
          issue: 'Test issue',
          severity: 'low',
          userId: 'user-1',
          traceId: 'test',
          sessionId: 'test',
        },
        id: 'envelope-123',
      },
      {} as any
    );

    expect(mockHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        __envelopeId: 'envelope-123',
      }),
      expect.anything(),
      'system_health_report'
    );

    vi.doUnmock('./events/health-handler');
  });
});
