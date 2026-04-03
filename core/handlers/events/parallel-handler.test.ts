import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock 'sst'
vi.mock('sst', () => ({
  Resource: new Proxy(
    {},
    {
      get: (_target, prop) => ({
        name: `test-${String(prop).toLowerCase()}`,
        value: 'test-value',
      }),
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

// 3. Mock DynamoDB
const { mockDdbSend } = vi.hoisted(() => ({
  mockDdbSend: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(function () {
      return { send: mockDdbSend };
    }),
  },
  PutCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
  GetCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
}));

// 4. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// 5. Mock ConfigManager
const { mockGetRawConfig } = vi.hoisted(() => ({
  mockGetRawConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: mockGetRawConfig,
  },
}));

// 6. Mock DynamicScheduler
const { mockScheduleOneShotTimeout } = vi.hoisted(() => ({
  mockScheduleOneShotTimeout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/lifecycle/scheduler', () => ({
  DynamicScheduler: {
    scheduleOneShotTimeout: mockScheduleOneShotTimeout,
  },
}));

// 7. Mock trace helper
const { mockAddTraceStep } = vi.hoisted(() => ({
  mockAddTraceStep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/utils/trace-helper', () => ({
  addTraceStep: mockAddTraceStep,
}));

// 8. Mock parallel aggregator
const { mockAggregatorInit, mockAggregatorMarkAsCompleted, mockAggregatorAddResult } = vi.hoisted(
  () => ({
    mockAggregatorInit: vi.fn().mockResolvedValue(undefined),
    mockAggregatorMarkAsCompleted: vi.fn().mockResolvedValue(true),
    mockAggregatorAddResult: vi.fn().mockResolvedValue(undefined),
  })
);

vi.mock('../../lib/agent/parallel-aggregator', () => ({
  aggregator: {
    init: mockAggregatorInit,
    markAsCompleted: mockAggregatorMarkAsCompleted,
    addResult: mockAggregatorAddResult,
  },
}));

// 9. Mock DAG executor
const { mockBuildDependencyGraph, mockValidateDependencyGraph, mockGetReadyTasks } = vi.hoisted(
  () => ({
    mockBuildDependencyGraph: vi.fn().mockReturnValue({ nodes: {}, readyQueue: [] }),
    mockValidateDependencyGraph: vi.fn().mockReturnValue(true),
    mockGetReadyTasks: vi.fn().mockReturnValue([]),
  })
);

vi.mock('../../lib/agent/dag-executor', () => ({
  buildDependencyGraph: mockBuildDependencyGraph,
  validateDependencyGraph: mockValidateDependencyGraph,
  getReadyTasks: mockGetReadyTasks,
}));

// 10. Mock typed emit
const { mockEmitTypedEvent } = vi.hoisted(() => ({
  mockEmitTypedEvent: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../lib/utils/typed-emit', () => ({
  emitTypedEvent: mockEmitTypedEvent,
}));

// 11. Mock schema events
vi.mock('../../lib/schema/events', () => ({
  EVENT_SCHEMA_MAP: {
    coder_task: {},
    test_agent_task: {},
  },
  SchemaEventType: {},
}));

// 12. Import code under test
import { handleParallelDispatch } from './parallel-handler';

describe('parallel-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRawConfig.mockResolvedValue(undefined);
    mockGetReadyTasks.mockReturnValue([]);
    mockValidateDependencyGraph.mockReturnValue(true);
  });

  const baseEvent = {
    detail: {
      userId: 'user-123',
      tasks: [
        {
          taskId: 'task-1',
          agentId: 'coder',
          task: 'Implement feature A',
        },
        {
          taskId: 'task-2',
          agentId: 'critic',
          task: 'Review feature A',
        },
      ],
      traceId: 'trace-abc',
      initiatorId: 'superclaw',
      sessionId: 'session-xyz',
    },
  };

  describe('handleParallelDispatch', () => {
    it('dispatches tasks and schedules barrier timeout for standard parallel execution', async () => {
      await handleParallelDispatch(baseEvent as any);

      expect(mockAggregatorInit).toHaveBeenCalledWith(
        'user-123',
        'trace-abc',
        2,
        'superclaw',
        'session-xyz',
        expect.arrayContaining([
          { taskId: 'task-1', agentId: 'coder' },
          { taskId: 'task-2', agentId: 'critic' },
        ]),
        undefined,
        undefined,
        expect.objectContaining({ hasDependencies: false })
      );

      expect(mockScheduleOneShotTimeout).toHaveBeenCalledWith(
        'parallel-barrier-trace-abc',
        expect.objectContaining({
          userId: 'user-123',
          traceId: 'trace-abc',
          taskCount: 2,
        }),
        expect.any(Number),
        'parallel_barrier_timeout'
      );

      expect(mockEmitTypedEvent).toHaveBeenCalledTimes(2);
    });

    it('returns early when tasks array is empty', async () => {
      const event = {
        detail: {
          userId: 'user-123',
          tasks: [],
          traceId: 'trace-abc',
        },
      };

      await handleParallelDispatch(event as any);

      expect(mockAggregatorInit).not.toHaveBeenCalled();
      // No tasks means no timeout scheduling needed (nothing to wait for)
      expect(mockScheduleOneShotTimeout).not.toHaveBeenCalled();
    });

    it('uses config override for barrier timeout', async () => {
      mockGetRawConfig.mockResolvedValue(120000);

      await handleParallelDispatch(baseEvent as any);

      const scheduledCall = mockScheduleOneShotTimeout.mock.calls[0];
      const targetTime = scheduledCall[2];
      const now = Date.now();

      // Target time should be approximately now + 120000ms
      expect(targetTime).toBeGreaterThan(now + 100000);
      expect(targetTime).toBeLessThan(now + 140000);
    });

    it('uses provided barrierTimeoutMs when config is not set', async () => {
      mockGetRawConfig.mockResolvedValue(undefined);
      const event = {
        detail: {
          ...baseEvent.detail,
          barrierTimeoutMs: 60000,
        },
      };

      await handleParallelDispatch(event as any);

      const scheduledCall = mockScheduleOneShotTimeout.mock.calls[0];
      const targetTime = scheduledCall[2];
      const now = Date.now();

      expect(targetTime).toBeGreaterThan(now + 50000);
      expect(targetTime).toBeLessThan(now + 70000);
    });

    it('generates traceId when not provided', async () => {
      const event = {
        detail: {
          userId: 'user-123',
          tasks: [{ taskId: 'task-1', agentId: 'coder', task: 'Do work' }],
        },
      };

      await handleParallelDispatch(event as any);

      expect(mockAggregatorInit).toHaveBeenCalledWith(
        'user-123',
        expect.stringMatching(/^parallel-\d+$/),
        1,
        'parallel-dispatcher',
        undefined,
        expect.any(Array),
        undefined,
        undefined,
        expect.any(Object)
      );
    });

    it('handles DAG mode with valid dependency graph', async () => {
      const dagEvent = {
        detail: {
          userId: 'user-123',
          tasks: [
            { taskId: 'task-1', agentId: 'coder', task: 'Build', dependsOn: [] },
            { taskId: 'task-2', agentId: 'critic', task: 'Review', dependsOn: ['task-1'] },
          ],
          traceId: 'trace-dag',
        },
      };

      const mockDagState = { nodes: {}, readyQueue: ['task-1'] };
      mockBuildDependencyGraph.mockReturnValue(mockDagState);
      mockGetReadyTasks.mockReturnValue([
        { taskId: 'task-1', agentId: 'coder', task: 'Build', dependsOn: [] },
      ]);

      await handleParallelDispatch(dagEvent as any);

      expect(mockValidateDependencyGraph).toHaveBeenCalledWith(mockDagState);
      expect(mockEmitTypedEvent).toHaveBeenCalledTimes(1);
      // Fix #3: DAG mode now also schedules barrier timeout
      expect(mockScheduleOneShotTimeout).toHaveBeenCalled();
    });

    it('fails dispatch when dependency graph has cycles', async () => {
      const dagEvent = {
        detail: {
          userId: 'user-123',
          tasks: [
            { taskId: 'task-1', agentId: 'coder', task: 'A', dependsOn: ['task-2'] },
            { taskId: 'task-2', agentId: 'critic', task: 'B', dependsOn: ['task-1'] },
          ],
          traceId: 'trace-cycle',
        },
      };

      mockValidateDependencyGraph.mockReturnValue(false);

      await handleParallelDispatch(dagEvent as any);

      expect(mockAggregatorMarkAsCompleted).toHaveBeenCalledWith(
        'user-123',
        'trace-cycle',
        'failed'
      );
      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        'events.handler',
        expect.anything(),
        expect.objectContaining({ overallStatus: 'failed' })
      );
    });

    it('marks aggregator as failed when barrier timeout scheduling fails', async () => {
      mockScheduleOneShotTimeout.mockRejectedValue(new Error('Scheduler unavailable'));

      await handleParallelDispatch(baseEvent as any);

      expect(mockAggregatorMarkAsCompleted).toHaveBeenCalledWith('user-123', 'trace-abc', 'failed');
      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        'events.handler',
        expect.anything(),
        expect.objectContaining({ overallStatus: 'failed' })
      );
    });

    it('records trace steps during dispatch', async () => {
      await handleParallelDispatch(baseEvent as any);

      expect(mockAddTraceStep).toHaveBeenCalledWith(
        'trace-abc',
        'root',
        expect.objectContaining({
          type: expect.any(String),
          content: expect.objectContaining({ taskCount: 2 }),
        })
      );
    });

    it('notifies aggregator when DAG dispatch has partial failures', async () => {
      const dagEvent = {
        detail: {
          userId: 'user-123',
          tasks: [
            { taskId: 'task-1', agentId: 'coder', task: 'Build', dependsOn: [] },
            { taskId: 'task-2', agentId: 'critic', task: 'Review', dependsOn: ['task-1'] },
          ],
          traceId: 'trace-partial-fail',
        },
      };

      const mockDagState = { nodes: {}, readyQueue: ['task-1'] };
      mockBuildDependencyGraph.mockReturnValue(mockDagState);
      mockGetReadyTasks.mockReturnValue([
        { taskId: 'task-1', agentId: 'coder', task: 'Build', dependsOn: [] },
      ]);

      // Make emitTypedEvent throw for the first call (simulating dispatch failure)
      mockEmitTypedEvent
        .mockRejectedValueOnce(new Error('EventBridge throttled'))
        .mockResolvedValue({ success: true });

      await handleParallelDispatch(dagEvent as any);

      // Aggregator should be notified of the dispatch failure
      expect(mockAggregatorAddResult).toHaveBeenCalledWith(
        'user-123',
        'trace-partial-fail',
        expect.objectContaining({
          taskId: 'task-1',
          status: 'failed',
          error: expect.stringContaining('EventBridge throttled'),
        })
      );
    });

    it('notifies aggregator when standard parallel dispatch has partial failures', async () => {
      // Make emitTypedEvent throw for one task
      mockEmitTypedEvent
        .mockRejectedValueOnce(new Error('Dispatch error'))
        .mockResolvedValue({ success: true });

      await handleParallelDispatch(baseEvent as any);

      expect(mockAggregatorAddResult).toHaveBeenCalledWith(
        'user-123',
        'trace-abc',
        expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('Dispatch failed'),
        })
      );
    });

    it('handles DAG mode with no ready tasks (all have unsatisfied dependencies)', async () => {
      const dagEvent = {
        detail: {
          userId: 'user-123',
          tasks: [
            { taskId: 'task-1', agentId: 'coder', task: 'A', dependsOn: ['task-2'] },
            { taskId: 'task-2', agentId: 'critic', task: 'B', dependsOn: ['task-3'] },
            { taskId: 'task-3', agentId: 'qa', task: 'C', dependsOn: ['task-1'] },
          ],
          traceId: 'trace-no-ready',
        },
      };

      const mockDagState = { nodes: {}, readyQueue: [] };
      mockBuildDependencyGraph.mockReturnValue(mockDagState);
      mockValidateDependencyGraph.mockReturnValue(true);
      mockGetReadyTasks.mockReturnValue([]);

      await handleParallelDispatch(dagEvent as any);

      // Should mark aggregator as failed and emit terminal event
      expect(mockAggregatorMarkAsCompleted).toHaveBeenCalledWith(
        'user-123',
        'trace-no-ready',
        'failed'
      );
      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        'events.handler',
        expect.anything(),
        expect.objectContaining({ overallStatus: 'failed' })
      );
    });

    it('handles DAG barrier timeout scheduling failure', async () => {
      const dagEvent = {
        detail: {
          userId: 'user-123',
          tasks: [
            { taskId: 'task-1', agentId: 'coder', task: 'Build', dependsOn: [] },
            { taskId: 'task-2', agentId: 'critic', task: 'Review', dependsOn: ['task-1'] },
          ],
          traceId: 'trace-dag-timeout-fail',
        },
      };

      const mockDagState = { nodes: {}, readyQueue: ['task-1'] };
      mockBuildDependencyGraph.mockReturnValue(mockDagState);
      mockGetReadyTasks.mockReturnValue([
        { taskId: 'task-1', agentId: 'coder', task: 'Build', dependsOn: [] },
      ]);
      mockScheduleOneShotTimeout.mockRejectedValue(new Error('Scheduler down'));

      await handleParallelDispatch(dagEvent as any);

      // Should mark aggregator as failed
      expect(mockAggregatorMarkAsCompleted).toHaveBeenCalledWith(
        'user-123',
        'trace-dag-timeout-fail',
        'failed'
      );
      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        'events.handler',
        expect.anything(),
        expect.objectContaining({ overallStatus: 'failed' })
      );
    });
  });
});
