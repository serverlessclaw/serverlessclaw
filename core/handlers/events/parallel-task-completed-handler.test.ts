import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// 2. Mock wakeupInitiator
const { mockWakeupInitiator } = vi.hoisted(() => ({
  mockWakeupInitiator: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./shared', () => ({
  wakeupInitiator: mockWakeupInitiator,
}));

// 3. Import code under test
import { handleParallelTaskCompleted } from './parallel-task-completed-handler';

describe('parallel-task-completed-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseEventDetail = {
    userId: 'user-123',
    sessionId: 'session-xyz',
    traceId: 'trace-abc',
    initiatorId: 'superclaw',
    overallStatus: 'success' as const,
    results: [
      { taskId: 'task-1', agentId: 'coder', status: 'success', result: 'Feature implemented' },
      { taskId: 'task-2', agentId: 'critic', status: 'success', result: 'Code reviewed' },
    ],
    taskCount: 2,
    completedCount: 2,
    elapsedMs: 15000,
  };

  describe('handleParallelTaskCompleted', () => {
    it('returns early when initiatorId is not provided', async () => {
      const detail = { ...baseEventDetail, initiatorId: undefined };
      await handleParallelTaskCompleted(detail);

      expect(mockWakeupInitiator).not.toHaveBeenCalled();
    });

    it('wakes up initiator with success summary', async () => {
      await handleParallelTaskCompleted(baseEventDetail);

      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        expect.stringContaining('SUCCESS'),
        'trace-abc',
        'session-xyz',
        1
      );
    });

    it('includes success emoji for success status', async () => {
      await handleParallelTaskCompleted(baseEventDetail);

      const summaryArg = mockWakeupInitiator.mock.calls[0][2];
      expect(summaryArg).toContain('✅');
    });

    it('includes warning emoji for partial status', async () => {
      const detail = {
        ...baseEventDetail,
        overallStatus: 'partial' as const,
        results: [
          { taskId: 'task-1', agentId: 'coder', status: 'success', result: 'Done' },
          { taskId: 'task-2', agentId: 'critic', status: 'failed', error: 'Timeout' },
        ],
        completedCount: 2,
      };

      await handleParallelTaskCompleted(detail);

      const summaryArg = mockWakeupInitiator.mock.calls[0][2];
      expect(summaryArg).toContain('⚠️');
      expect(summaryArg).toContain('PARTIAL');
    });

    it('includes error emoji for failed status', async () => {
      const detail = {
        ...baseEventDetail,
        overallStatus: 'failed' as const,
        results: [{ taskId: 'task-1', agentId: 'coder', status: 'failed', error: 'Crashed' }],
        completedCount: 1,
      };

      await handleParallelTaskCompleted(detail);

      const summaryArg = mockWakeupInitiator.mock.calls[0][2];
      expect(summaryArg).toContain('❌');
      expect(summaryArg).toContain('FAILED');
    });

    it('includes elapsed time in summary', async () => {
      await handleParallelTaskCompleted(baseEventDetail);

      const summaryArg = mockWakeupInitiator.mock.calls[0][2];
      expect(summaryArg).toContain('15s');
    });

    it('counts success, failed, and timeout results correctly', async () => {
      const detail = {
        ...baseEventDetail,
        overallStatus: 'partial' as const,
        results: [
          { taskId: 'task-1', agentId: 'coder', status: 'success', result: 'Done' },
          { taskId: 'task-2', agentId: 'critic', status: 'failed', error: 'Error' },
          { taskId: 'task-3', agentId: 'qa', status: 'timeout' },
        ],
        taskCount: 3,
        completedCount: 3,
      };

      await handleParallelTaskCompleted(detail);

      const summaryArg = mockWakeupInitiator.mock.calls[0][2];
      expect(summaryArg).toContain('1 succeeded');
      expect(summaryArg).toContain('1 failed');
      expect(summaryArg).toContain('1 timed out');
    });

    it('truncates long result snippets to 200 chars', async () => {
      const longResult = 'A'.repeat(500);
      const detail = {
        ...baseEventDetail,
        results: [{ taskId: 'task-1', agentId: 'coder', status: 'success', result: longResult }],
        taskCount: 1,
        completedCount: 1,
      };

      await handleParallelTaskCompleted(detail);

      const summaryArg = mockWakeupInitiator.mock.calls[0][2];
      expect(summaryArg).toContain('A'.repeat(200));
      expect(summaryArg).not.toContain('A'.repeat(201));
    });
  });
});
