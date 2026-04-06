import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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

// 5. Mock merger-handler
const { mockHandlePatchMerge } = vi.hoisted(() => ({
  mockHandlePatchMerge: vi.fn(),
}));

vi.mock('./merger-handler', () => ({
  handlePatchMerge: mockHandlePatchMerge,
}));

// 6. Mock typed-emit and outbound
const { mockEmitTypedEvent, mockSendOutboundMessage } = vi.hoisted(() => ({
  mockEmitTypedEvent: vi.fn().mockResolvedValue({}),
  mockSendOutboundMessage: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/utils/typed-emit', () => ({
  emitTypedEvent: mockEmitTypedEvent,
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: mockSendOutboundMessage,
}));

// 7. Import code under test
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
        1,
        false,
        undefined,
        'trace-abc'
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
        1,
        false,
        undefined,
        'trace-abc'
      );
    });

    it('performs procedural patch merge when aggregationType is merge_patches', async () => {
      mockHandlePatchMerge.mockResolvedValue({
        success: true,
        appliedCount: 2,
        totalCount: 2,
        appliedPatches: ['task-1', 'task-2'],
        failedPatches: [],
        deploymentTriggered: true,
        summary: 'Merge Complete: 2/2 patches applied',
      });

      const detail = {
        ...baseEventDetail,
        aggregationType: 'merge_patches' as const,
      };

      await handleParallelTaskCompleted(detail);

      expect(mockHandlePatchMerge).toHaveBeenCalled();
      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-123',
        'superclaw',
        'Merge Complete: 2/2 patches applied',
        'trace-abc',
        'session-xyz',
        1,
        false,
        undefined,
        'trace-abc'
      );
    });

    it('dispatches to MergerAgent when procedural merge fails (Tier 2 Fallback)', async () => {
      mockHandlePatchMerge.mockResolvedValue({
        success: false,
        appliedCount: 1,
        totalCount: 2,
        appliedPatches: ['task-1'],
        failedPatches: [{ agentId: 'coder-2', taskId: 'task-2', error: 'conflict', patch: 'diff' }],
        deploymentTriggered: false,
        summary: 'Merge Partial: 1/2 patches applied',
      });

      const detail = {
        ...baseEventDetail,
        aggregationType: 'merge_patches' as const,
      };

      await handleParallelTaskCompleted(detail);

      // Should dispatch to MergerAgent
      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        'events',
        'merger_task',
        expect.objectContaining({
          task: expect.stringContaining('Resolve the following semantic conflicts'),
        })
      );

      // Should notify user
      expect(mockSendOutboundMessage).toHaveBeenCalledWith(
        'events',
        'user-123',
        expect.stringContaining('Merge Conflict Detected'),
        ['user-123'],
        'session-xyz',
        'System'
      );

      // Should NOT wake up initiator yet (waiting for MergerAgent)
      expect(mockWakeupInitiator).not.toHaveBeenCalled();
    });

    it('falls back to summary and notifies user when MergerAgent dispatch fails', async () => {
      mockEmitTypedEvent.mockRejectedValueOnce(new Error('EventBus Error'));

      mockHandlePatchMerge.mockResolvedValue({
        success: false,
        appliedCount: 1,
        totalCount: 2,
        appliedPatches: ['task-1'],
        failedPatches: [{ agentId: 'coder-2', taskId: 'task-2', error: 'conflict', patch: 'diff' }],
        deploymentTriggered: false,
        summary: 'Merge Partial: 1/2 patches applied',
      });

      const detail = {
        ...baseEventDetail,
        aggregationType: 'merge_patches' as const,
      };

      await handleParallelTaskCompleted(detail);

      // Should notify user of the dispatch failure
      expect(mockSendOutboundMessage).toHaveBeenCalledWith(
        'AgentBus',
        'user-123',
        expect.stringContaining('Reconciliation Failed'),
        ['user-123'],
        'session-xyz',
        'System'
      );

      // Should fall back to waking up initiator with the partial summary
      expect(mockWakeupInitiator).toHaveBeenCalled();
    });

    it('routes researcher-initiated parallel dispatches back to research_task', async () => {
      const detail = {
        ...baseEventDetail,
        initiatorId: 'researcher',
        aggregationType: 'agent_guided' as const,
      };

      await handleParallelTaskCompleted(detail);

      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-123',
        'researcher',
        expect.stringContaining('[AGGREGATED_RESULTS]'),
        'trace-abc',
        'session-xyz',
        1,
        false,
        undefined,
        'trace-abc', // taskId
        'research_task' // eventType
      );
    });
  });
});
