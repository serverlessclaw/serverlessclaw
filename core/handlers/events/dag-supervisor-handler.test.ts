import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handleDagStep } from './dag-supervisor-handler';
import { aggregator } from '../../lib/agent/parallel-aggregator';
import * as dagExecutor from '../../lib/agent/dag-executor';
import { emitTypedEvent } from '../../lib/utils/typed-emit';
import { EventType } from '../../lib/types/agent';

// Mock Aggregator
vi.mock('../../lib/agent/parallel-aggregator', () => ({
  aggregator: {
    getState: vi.fn(),
    updateDagState: vi.fn().mockResolvedValue(true),
    markAsCompleted: vi.fn().mockResolvedValue(true),
  },
}));

// Mock DAG Executor
vi.mock('../../lib/agent/dag-executor', () => ({
  buildDependencyGraph: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn(),
  getReadyTasks: vi.fn().mockReturnValue([]),
  isExecutionComplete: vi.fn().mockReturnValue(false),
  getExecutionSummary: vi.fn().mockReturnValue({ completed: 1, failed: 0, pending: 0, ready: 0 }),
  createTaskWithDependencyContext: vi.fn((task) => task.task),
}));

// Mock Typed Emit
vi.mock('../../lib/utils/typed-emit', () => ({
  emitTypedEvent: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('dag-supervisor-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseEventDetail = {
    userId: 'user-1',
    traceId: 'trace-1',
    taskId: 'task-1',
    agentId: 'coder',
    response: 'done',
    sessionId: 'sess-1',
    depth: 1,
  };

  it('should update DAG state and dispatch ready tasks', async () => {
    const mockState = {
      metadata: {
        dagState: { nodes: {}, outputs: {} },
        initiatorId: 'planner',
      },
      version: 1,
      userId: 'user-1',
      traceId: 'trace-1',
    };
    (aggregator.getState as any).mockResolvedValue(mockState);

    const readyTask = { taskId: 'task-2', agentId: 'critic', task: 'review' };
    (dagExecutor.getReadyTasks as any).mockReturnValue([readyTask]);

    await handleDagStep(baseEventDetail, 'DAG_TASK_COMPLETED');

    expect(dagExecutor.completeTask).toHaveBeenCalledWith(expect.anything(), 'task-1', 'done');
    expect(aggregator.updateDagState).toHaveBeenCalledWith(
      'user-1',
      'trace-1',
      expect.anything(),
      1
    );
    expect(emitTypedEvent).toHaveBeenCalledWith(
      'agent.dag',
      'critic_task',
      expect.objectContaining({
        taskId: 'task-2',
        task: 'review',
      })
    );
  });

  it('should handle task failure and update DAG accordingly', async () => {
    const mockState = {
      metadata: { dagState: { nodes: {} } },
      version: 1,
      userId: 'user-1',
      traceId: 'trace-1',
    };
    (aggregator.getState as any).mockResolvedValue(mockState);

    await handleDagStep({ ...baseEventDetail, error: 'failed' }, 'DAG_TASK_FAILED');

    expect(dagExecutor.failTask).toHaveBeenCalledWith(expect.anything(), 'task-1', 'failed');
  });

  it('should emit PARALLEL_TASK_COMPLETED when DAG is finished', async () => {
    const mockState = {
      metadata: { dagState: { nodes: {} } },
      version: 1,
      userId: 'user-1',
      traceId: 'trace-1',
      taskCount: 1,
      results: [{ taskId: 'task-1', status: 'success' }],
      createdAt: Date.now(),
    };
    (aggregator.getState as any).mockResolvedValue(mockState);
    (dagExecutor.isExecutionComplete as any).mockReturnValue(true);

    await handleDagStep(baseEventDetail, 'DAG_TASK_COMPLETED');

    expect(aggregator.markAsCompleted).toHaveBeenCalled();
    expect(emitTypedEvent).toHaveBeenCalledWith(
      'events.handler',
      EventType.PARALLEL_TASK_COMPLETED,
      expect.objectContaining({
        overallStatus: 'success',
        completedCount: 1,
      })
    );
  });
});
