import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock 'sst'
vi.mock('sst', () => ({
  Resource: new Proxy(
    {},
    {
      get: (_target, prop) => {
        return {
          name: `test-${String(prop).toLowerCase()}`,
        };
      },
    }
  ),
}));

// Mock logger
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock ConfigManager
vi.mock('../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockImplementation((key) => {
      if (key === 'parallel_barrier_timeout_ms') return 300000;
      if (key === 'parallel_partial_success_threshold') return 0.5;
      return null;
    }),
  },
}));

// Mock ParallelAggregator
const { mockInit, mockAddResult, mockGetState, mockMarkAsCompleted } = vi.hoisted(() => ({
  mockInit: vi.fn(),
  mockAddResult: vi.fn(),
  mockGetState: vi.fn(),
  mockMarkAsCompleted: vi.fn().mockResolvedValue(true),
}));

vi.mock('../lib/agent/parallel-aggregator', () => {
  return {
    aggregator: {
      init: mockInit,
      addResult: mockAddResult,
      getState: mockGetState,
      markAsCompleted: mockMarkAsCompleted,
    },
    ParallelAggregator: vi.fn().mockImplementation(function () {
      return {
        init: mockInit,
        addResult: mockAddResult,
        getState: mockGetState,
        markAsCompleted: mockMarkAsCompleted,
      };
    }),
  };
});

// Mock DynamicScheduler
vi.mock('../lib/scheduler', () => ({
  DynamicScheduler: {
    scheduleOneShotTimeout: vi.fn().mockResolvedValue({}),
  },
}));

// Mock bus
vi.mock('../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue({}),
  EventPriority: {
    HIGH: 'high',
    CRITICAL: 'critical',
  },
}));

import { handleParallelDispatch } from './events/parallel-handler';
import { handleParallelBarrierTimeout } from './events/parallel-barrier-timeout-handler';
import { handleTaskCancellation } from './events/cancellation-handler';
import { EventType } from '../lib/types/agent';

// Mock DynamoDB
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({
        send: mockSend,
      }),
    },
  };
});

describe('Parallel Dispatch Resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleTaskCancellation', () => {
    it('should fan out cancellation to all parallel tasks', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            taskMapping: [
              { taskId: 't1', agentId: 'a1' },
              { taskId: 't2', agentId: 'a2' },
            ],
          },
        ],
      });

      const event = {
        detail: {
          parallelDispatchId: 'p1',
          userId: 'u1',
          initiatorId: 'user',
          reason: 'Stop all',
        },
      };

      await handleTaskCancellation(event as any);

      // 1 query for state, 2 puts for flags
      expect(mockSend).toHaveBeenCalledTimes(3);

      const { emitEvent } = await import('../lib/utils/bus');
      expect(emitEvent).toHaveBeenCalledTimes(2);
      expect(emitEvent).toHaveBeenCalledWith(
        'agent.cancellation',
        EventType.TASK_CANCELLED,
        expect.objectContaining({ taskId: 't1', agentId: 'a1' }),
        expect.any(Object)
      );
    });
  });

  describe('handleParallelDispatch', () => {
    it('should initialize aggregator and dispatch tasks', async () => {
      const eventDetail = {
        userId: 'user-1',
        traceId: 'trace-1',
        tasks: [
          { taskId: 'task-1', agentId: 'coder', task: 'Work 1' },
          { taskId: 'task-2', agentId: 'qa', task: 'Work 2' },
        ],
      };

      await handleParallelDispatch({ detail: eventDetail } as any);

      expect(mockInit).toHaveBeenCalledWith(
        'user-1',
        'trace-1',
        2,
        'parallel-dispatcher',
        undefined, // sessionId
        [
          { taskId: 'task-1', agentId: 'coder' },
          { taskId: 'task-2', agentId: 'qa' },
        ],
        undefined, // aggregationType
        undefined, // aggregationPrompt
        expect.any(Object) // aggregatorMetadata
      );

      const { emitEvent } = await import('../lib/utils/bus');
      expect(emitEvent).toHaveBeenCalledTimes(2);
      expect(emitEvent).toHaveBeenCalledWith(
        'agent.parallel',
        'coder_task',
        expect.objectContaining({ taskId: 'task-1' }),
        {}
      );

      const { DynamicScheduler } = await import('../lib/scheduler');
      expect(DynamicScheduler.scheduleOneShotTimeout).toHaveBeenCalledWith(
        expect.stringContaining('parallel-barrier-trace-1'),
        expect.objectContaining({ traceId: 'trace-1', taskCount: 2 }),
        expect.any(Number),
        EventType.PARALLEL_BARRIER_TIMEOUT
      );
    });
  });

  describe('handleParallelBarrierTimeout', () => {
    it('should mark missing tasks as timed out and emit completion', async () => {
      mockGetState.mockResolvedValue({
        taskCount: 2,
        completedCount: 1,
        results: [{ taskId: 'task-1', status: 'success', agentId: 'coder' }],
        taskMapping: [
          { taskId: 'task-1', agentId: 'coder' },
          { taskId: 'task-2', agentId: 'qa' },
        ],
        initiatorId: 'planner',
        createdAt: Date.now() - 1000,
      });

      mockAddResult.mockResolvedValue({
        isComplete: true,
        taskCount: 2,
        results: [
          { taskId: 'task-1', status: 'success', agentId: 'coder' },
          { taskId: 'task-2', status: 'timeout', agentId: 'qa' },
        ],
        initiatorId: 'planner',
      });

      const eventDetail = {
        userId: 'user-1',
        traceId: 'trace-1',
        taskCount: 2,
      };

      await handleParallelBarrierTimeout(eventDetail as any);

      expect(mockAddResult).toHaveBeenCalledWith(
        'user-1',
        'trace-1',
        expect.objectContaining({ taskId: 'task-2', status: 'timeout' })
      );

      const { emitEvent } = await import('../lib/utils/bus');
      expect(emitEvent).toHaveBeenCalledWith(
        'events.handler',
        EventType.PARALLEL_TASK_COMPLETED,
        expect.objectContaining({
          overallStatus: 'partial', // 1/2 success = 50% threshold
          completedCount: 2,
        }),
        expect.any(Object)
      );
    });

    it('should mark overall status as failed if below threshold', async () => {
      mockGetState.mockResolvedValue({
        taskCount: 3,
        completedCount: 0,
        results: [],
        taskMapping: [
          { taskId: 't1', agentId: 'a1' },
          { taskId: 't2', agentId: 'a2' },
          { taskId: 't3', agentId: 'a3' },
        ],
        initiatorId: 'planner',
      });

      mockAddResult.mockResolvedValue({
        results: [
          { taskId: 't1', status: 'timeout', agentId: 'a1' },
          { taskId: 't2', status: 'timeout', agentId: 'a2' },
          { taskId: 't3', status: 'timeout', agentId: 'a3' },
        ],
      });

      await handleParallelBarrierTimeout({ userId: 'u1', traceId: 'tr1', taskCount: 3 } as any);

      const { emitEvent } = await import('../lib/utils/bus');
      expect(emitEvent).toHaveBeenCalledWith(
        'events.handler',
        EventType.PARALLEL_TASK_COMPLETED,
        expect.objectContaining({
          overallStatus: 'failed',
        }),
        expect.any(Object)
      );
    });
  });
});
