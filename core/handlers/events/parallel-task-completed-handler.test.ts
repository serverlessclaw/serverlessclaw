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

// 3. Mock agent-helpers
const { mockLoadAgentConfig, mockGetAgentContext } = vi.hoisted(() => ({
  mockLoadAgentConfig: vi.fn(),
  mockGetAgentContext: vi.fn(),
}));

vi.mock('../../lib/utils/agent-helpers', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    loadAgentConfig: mockLoadAgentConfig,
    getAgentContext: mockGetAgentContext,
  };
});

// 4. Mock Agent
const { mockAgentProcess } = vi.hoisted(() => ({
  mockAgentProcess: vi.fn().mockResolvedValue({
    responseText: 'Synthesized result',
    attachments: [],
  }),
}));

vi.mock('../../lib/agent', () => {
  return {
    Agent: vi.fn().mockImplementation(function () {
      return {
        process: mockAgentProcess,
      };
    }),
  };
});

// 5. Import code under test
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

    it('performs agent-guided aggregation using the initiatorId for config', async () => {
      mockLoadAgentConfig.mockResolvedValue({
        id: 'strategic-planner',
        name: 'Strategic Planner',
        systemPrompt: 'You are a planner',
      });
      mockGetAgentContext.mockResolvedValue({
        memory: {},
        provider: {},
      });
      mockAgentProcess.mockResolvedValue({
        responseText: 'Synthesized result',
        attachments: [],
      });

      const detail = {
        ...baseEventDetail,
        initiatorId: 'strategic-planner',
        aggregationType: 'agent_guided' as const,
      };

      await handleParallelTaskCompleted(detail);

      expect(mockLoadAgentConfig).toHaveBeenCalledWith('strategic-planner');
      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-123',
        'strategic-planner',
        'Synthesized result',
        'trace-abc',
        'session-xyz',
        1
      );
    });
  });
});
