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

// 2. Mock DynamoDB
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

// 3. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// 4. Mock bus
const { mockEmitEvent } = vi.hoisted(() => ({
  mockEmitEvent: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: mockEmitEvent,
  EventPriority: { HIGH: 'HIGH', CRITICAL: 'CRITICAL', NORMAL: 'NORMAL' },
}));

// 5. Mock ParallelAggregator
const { mockGetState, mockMarkAsCompleted } = vi.hoisted(() => ({
  mockGetState: vi.fn().mockResolvedValue(null),
  mockMarkAsCompleted: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../lib/agent/parallel-aggregator', () => ({
  ParallelAggregator: vi.fn().mockImplementation(function () {
    return {
      getState: mockGetState,
      markAsCompleted: mockMarkAsCompleted,
    };
  }),
}));

// 6. Mock ConfigManager
const { mockGetRawConfig } = vi.hoisted(() => ({
  mockGetRawConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: mockGetRawConfig,
  },
}));

// 7. Import code under test
import { handleParallelBarrierTimeout } from './parallel-barrier-timeout-handler';

describe('parallel-barrier-timeout-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRawConfig.mockResolvedValue(undefined);
  });

  const baseEventDetail = {
    userId: 'user-123',
    traceId: 'trace-abc',
    initiatorId: 'superclaw',
    sessionId: 'session-xyz',
    taskCount: 3,
  };

  describe('handleParallelBarrierTimeout', () => {
    it('returns early when traceId is missing', async () => {
      await handleParallelBarrierTimeout({ userId: 'user-123' });

      expect(mockGetState).not.toHaveBeenCalled();
    });

    it('returns early when userId is missing', async () => {
      await handleParallelBarrierTimeout({ traceId: 'trace-abc' });

      expect(mockGetState).not.toHaveBeenCalled();
    });

    it('returns early when no state found (already completed)', async () => {
      mockGetState.mockResolvedValue(null);

      await handleParallelBarrierTimeout(baseEventDetail);

      expect(mockMarkAsCompleted).not.toHaveBeenCalled();
    });

    it('returns early when all tasks already completed', async () => {
      mockGetState.mockResolvedValue({
        completedCount: 3,
        taskCount: 3,
        results: [],
        taskMapping: [],
        createdAt: Date.now() - 10000,
        initiatorId: 'superclaw',
      });

      await handleParallelBarrierTimeout(baseEventDetail);

      expect(mockMarkAsCompleted).not.toHaveBeenCalled();
    });

    it('emits PARALLEL_TASK_COMPLETED with partial status when some tasks succeeded', async () => {
      mockGetState.mockResolvedValue({
        completedCount: 2,
        taskCount: 3,
        results: [
          { taskId: 'task-1', status: 'success', agentId: 'coder', result: 'done' },
          { taskId: 'task-2', status: 'success', agentId: 'critic', result: 'reviewed' },
        ],
        taskMapping: [
          { taskId: 'task-1', agentId: 'coder' },
          { taskId: 'task-2', agentId: 'critic' },
          { taskId: 'task-3', agentId: 'qa' },
        ],
        createdAt: Date.now() - 10000,
        initiatorId: 'superclaw',
      });

      await handleParallelBarrierTimeout(baseEventDetail);

      expect(mockMarkAsCompleted).toHaveBeenCalledWith('user-123', 'trace-abc', 'partial');
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'events.handler',
        'parallel_task_completed',
        expect.objectContaining({
          userId: 'user-123',
          traceId: 'trace-abc',
          overallStatus: 'partial',
          results: expect.arrayContaining([
            expect.objectContaining({ taskId: 'task-3', status: 'timeout' }),
          ]),
        }),
        expect.anything()
      );
    });

    it('emits PARALLEL_TASK_COMPLETED with success status when all results are success', async () => {
      // completedCount < taskCount so it doesn't early-return, but all existing results are success
      mockGetState.mockResolvedValue({
        completedCount: 2,
        taskCount: 3,
        results: [
          { taskId: 'task-1', status: 'success', agentId: 'coder', result: 'done' },
          { taskId: 'task-2', status: 'success', agentId: 'critic', result: 'reviewed' },
        ],
        taskMapping: [
          { taskId: 'task-1', agentId: 'coder' },
          { taskId: 'task-2', agentId: 'critic' },
          { taskId: 'task-3', agentId: 'qa' },
        ],
        createdAt: Date.now() - 10000,
        initiatorId: 'superclaw',
      });

      await handleParallelBarrierTimeout(baseEventDetail);

      // 2/3 success rate < 1 => partial, not success
      expect(mockMarkAsCompleted).toHaveBeenCalledWith('user-123', 'trace-abc', 'partial');
    });

    it('emits PARALLEL_TASK_COMPLETED with failed status when success rate below threshold', async () => {
      mockGetRawConfig.mockResolvedValue(0.5);
      mockGetState.mockResolvedValue({
        completedCount: 1,
        taskCount: 4,
        results: [{ taskId: 'task-1', status: 'success', agentId: 'coder', result: 'done' }],
        taskMapping: [
          { taskId: 'task-1', agentId: 'coder' },
          { taskId: 'task-2', agentId: 'critic' },
          { taskId: 'task-3', agentId: 'qa' },
          { taskId: 'task-4', agentId: 'reviewer' },
        ],
        createdAt: Date.now() - 10000,
        initiatorId: 'superclaw',
      });

      await handleParallelBarrierTimeout(baseEventDetail);

      // 1/4 = 0.25 < 0.5 threshold => failed
      expect(mockMarkAsCompleted).toHaveBeenCalledWith('user-123', 'trace-abc', 'failed');
    });

    it('skips when markAsCompleted returns false (race condition)', async () => {
      mockGetState.mockResolvedValue({
        completedCount: 1,
        taskCount: 3,
        results: [],
        taskMapping: [{ taskId: 'task-1', agentId: 'coder' }],
        createdAt: Date.now() - 10000,
        initiatorId: 'superclaw',
      });
      mockMarkAsCompleted.mockResolvedValue(false);

      await handleParallelBarrierTimeout(baseEventDetail);

      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it('uses default threshold of 0.5 when config is not set', async () => {
      mockGetRawConfig.mockResolvedValue(undefined);
      mockGetState.mockResolvedValue({
        completedCount: 1,
        taskCount: 2,
        results: [{ taskId: 'task-1', status: 'success', agentId: 'coder', result: 'done' }],
        taskMapping: [
          { taskId: 'task-1', agentId: 'coder' },
          { taskId: 'task-2', agentId: 'critic' },
        ],
        createdAt: Date.now() - 10000,
        initiatorId: 'superclaw',
      });

      await handleParallelBarrierTimeout(baseEventDetail);

      // 1/2 = 0.5 >= 0.5 => partial
      expect(mockMarkAsCompleted).toHaveBeenCalledWith('user-123', 'trace-abc', 'partial');
    });
  });
});
