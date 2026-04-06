import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventType } from '../lib/types/agent';
import { ParallelTaskStatus } from '../lib/types/constants';

// Mock dependencies
vi.mock('sst', () => ({
  Resource: new Proxy({}, { get: () => ({ name: 'test-table' }) }),
}));

const { mockSend, mockDdbSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
  mockDdbSend: vi.fn().mockResolvedValue({}),
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn().mockImplementation(function (this: any) {
    this.send = mockSend;
  }),
  PutEventsCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
  UpdateCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
  GetCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
  PutCommand: vi.fn().mockImplementation(function (this: any, args) {
    this.input = args;
    return this;
  }),
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue({ success: true }),
  EventPriority: { HIGH: 'HIGH' },
}));

const { mockGetState, mockMarkAsCompleted } = vi.hoisted(() => ({
  mockGetState: vi.fn(),
  mockMarkAsCompleted: vi.fn(),
}));

vi.mock('../lib/agent/parallel-aggregator', () => ({
  ParallelAggregator: vi.fn().mockImplementation(function (this: any) {
    this.getState = mockGetState;
    this.markAsCompleted = mockMarkAsCompleted;
    return this;
  }),
  aggregator: {
    getState: mockGetState,
    markAsCompleted: mockMarkAsCompleted,
  },
}));

vi.mock('../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockResolvedValue(0.5),
  },
}));

// Import handlers
import { handleParallelBarrierTimeout } from '../handlers/events/parallel-barrier-timeout-handler';
import { handleTaskResult as _handleTaskResult } from '../handlers/events/task-result-handler';

describe('Parallel Dispatch Stress Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle race condition between worker completion and timeout', async () => {
    const traceId = 'stress-race-1';
    const userId = 'user-1';

    // 1. Setup aggregator state: 2/3 tasks completed
    const state = {
      userId: `PARALLEL#${userId}#${traceId}`,
      taskCount: 3,
      completedCount: 2,
      status: 'pending',
      results: [
        { taskId: 't1', status: 'success', agentId: 'coder' },
        { taskId: 't2', status: 'success', agentId: 'critic' },
      ],
      taskMapping: [
        { taskId: 't1', agentId: 'coder' },
        { taskId: 't2', agentId: 'critic' },
        { taskId: 't3', agentId: 'qa' },
      ],
      initiatorId: 'superclaw',
      createdAt: Date.now() - 60000,
    };

    // Mock aggregator.getState
    mockGetState.mockResolvedValue(state as any);

    // Mock markAsCompleted to simulate race condition (timeout loses)
    mockMarkAsCompleted.mockResolvedValue(false);

    // Run timeout handler
    await handleParallelBarrierTimeout({ userId, traceId, taskCount: 3, initiatorId: 'superclaw' });

    // Verify timeout handler skipped emission because it couldn't mark as completed
    const { emitEvent } = await import('../lib/utils/bus');
    expect(mockMarkAsCompleted).toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('should synthesize results for all missing tasks on timeout', async () => {
    const traceId = 'stress-timeout-1';
    const userId = 'user-1';

    // 1. Setup aggregator state: 1/3 tasks completed
    const state = {
      userId: `PARALLEL#${userId}#${traceId}`,
      taskCount: 3,
      completedCount: 1,
      status: 'pending',
      results: [{ taskId: 't1', status: 'success', agentId: 'coder' }],
      taskMapping: [
        { taskId: 't1', agentId: 'coder' },
        { taskId: 't2', agentId: 'critic' },
        { taskId: 't3', agentId: 'qa' },
      ],
      initiatorId: 'superclaw',
      createdAt: Date.now() - 60000,
    };

    mockGetState.mockResolvedValue(state as any);
    mockMarkAsCompleted.mockResolvedValue(true);

    // Run timeout handler
    await handleParallelBarrierTimeout({ userId, traceId, taskCount: 3, initiatorId: 'superclaw' });

    // Verify terminal event has all 3 results (1 original + 2 synthesized)
    const { emitEvent } = await import('../lib/utils/bus');
    expect(emitEvent).toHaveBeenCalledWith(
      'events.handler',
      EventType.PARALLEL_TASK_COMPLETED,
      expect.objectContaining({
        overallStatus: ParallelTaskStatus.TIMED_OUT,
        results: expect.arrayContaining([
          expect.objectContaining({ taskId: 't1', status: 'success' }),
          expect.objectContaining({ taskId: 't2', status: 'timed_out' }),
          expect.objectContaining({ taskId: 't3', status: 'timed_out' }),
        ]),
        completedCount: 3,
      }),
      expect.anything()
    );
  });

  it('should handle partial success threshold correctly', async () => {
    const traceId = 'stress-partial-1';
    const userId = 'user-1';

    // 2/3 success = 66%, which is > 50% threshold
    const state = {
      taskCount: 3,
      completedCount: 3,
      results: [
        { taskId: 't1', status: 'success', agentId: 'coder' },
        { taskId: 't2', status: 'success', agentId: 'critic' },
        { taskId: 't3', status: 'failed', agentId: 'qa' },
      ],
      taskMapping: [],
      status: 'pending',
      initiatorId: 'superclaw',
    };

    mockGetState.mockResolvedValue(state as any);
    mockMarkAsCompleted.mockResolvedValue(true);

    await handleParallelBarrierTimeout({ userId, traceId, taskCount: 3, initiatorId: 'superclaw' });

    const { emitEvent } = await import('../lib/utils/bus');
    expect(emitEvent).toHaveBeenCalledWith(
      'events.handler',
      EventType.PARALLEL_TASK_COMPLETED,
      expect.objectContaining({
        overallStatus: 'partial',
      }),
      expect.anything()
    );
  });
});
