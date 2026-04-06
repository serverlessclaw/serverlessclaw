import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * Integration test for the full recursive swarm flow:
 * Strategic Planner -> Researcher/Coder -> Parallel Workers -> Aggregation -> Result
 *
 * This test verifies the sequence diagram from the walkthrough:
 *
 * ```text
 * SP -> R: Delegate: "Research Auth0 vs Cognito"
 * R -> RP: Parallel: "Scan Auth0", "Scan Cognito"
 * RP -->> PA: Task Completed
 * PA -> R: Aggregated Findings [AGGREGATED_RESULTS]
 * R -> SP: Mission Complete: "Cognito is better because..."
 * SP -> C: Delegate: "Implement Cognito"
 * C -> CP: Parallel: "Setup Infra", "UI Integration"
 * CP -->> PA: Patches Generated
 * PA -> C: Merged Patch [AGGREGATED_RESULTS]
 * C -> SP: Mission Complete: "Cognito Deployed"
 * ```
 */

// 1. Mock Logger
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// 2. Mock decomposer
const { mockDecomposePlan } = vi.hoisted(() => ({
  mockDecomposePlan: vi.fn(),
}));

vi.mock('../lib/agent/decomposer', () => ({
  decomposePlan: mockDecomposePlan,
}));

// 3. Mock typed-emit
const { mockEmitTypedEvent, mockEmitTaskCompleted } = vi.hoisted(() => ({
  mockEmitTypedEvent: vi.fn().mockResolvedValue(undefined),
  mockEmitTaskCompleted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/utils/typed-emit', () => ({
  emitTypedEvent: mockEmitTypedEvent,
  emitTaskCompleted: mockEmitTaskCompleted,
}));

// 4. Mock Agent process, init and config (stub `initAgent` to avoid touching SST/Dynamo)
const { mockAgentProcess } = vi.hoisted(() => ({
  mockAgentProcess: vi.fn().mockResolvedValue({
    responseText: 'Research synthesis complete',
    attachments: [],
  }),
}));

const { mockInitAgent, mockLoadAgentConfig, mockGetAgentTools } = vi.hoisted(() => {
  const memoryMock = {
    addMemory: vi.fn().mockResolvedValue(1),
    searchInsights: vi.fn().mockResolvedValue({ items: [] }),
  } as any;

  return {
    mockInitAgent: vi.fn().mockResolvedValue({
      memory: memoryMock,
      agent: { process: mockAgentProcess },
    }),
    mockLoadAgentConfig: vi.fn().mockImplementation(async (agentId: string) => ({
      systemPrompt: `${agentId} system prompt`,
      tools: ['tool1', 'tool2'],
    })),
    mockGetAgentTools: vi.fn().mockResolvedValue(['tool1', 'tool2', 'tool3']),
  };
});

vi.mock('../lib/utils/agent-helpers', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    initAgent: mockInitAgent,
    loadAgentConfig: mockLoadAgentConfig,
    getAgentTools: mockGetAgentTools,
  };
});

// 5. Mock Agent class (uses mockAgentProcess defined above)
vi.mock('../lib/agent', () => {
  return {
    Agent: vi.fn().mockImplementation(function () {
      return {
        process: mockAgentProcess,
      };
    }),
  };
});

// 6. Mock schema
vi.mock('../lib/schema/events', () => ({
  RESEARCH_TASK_METADATA: {
    parse: vi.fn().mockReturnValue({
      tokenBudget: 100000,
      timeBudgetMs: 300000,
    }),
  },
}));

// 6b. Mock tools index (heavy module that causes timeouts)
vi.mock('../tools/index', () => ({
  getAgentTools: mockGetAgentTools,
}));

// 6b. Mock tools index (heavy module that causes timeouts)
vi.mock('../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue(['tool1', 'tool2']),
}));

// 7. Mock merger-handler
const { mockHandlePatchMerge } = vi.hoisted(() => ({
  mockHandlePatchMerge: vi.fn().mockResolvedValue({
    success: true,
    appliedCount: 2,
    totalCount: 2,
    appliedPatches: ['patch-1', 'patch-2'],
    failedPatches: [],
    deploymentTriggered: false,
    summary: '[AGGREGATED_RESULTS]\nMerge Complete: 2/2 patches applied',
  }),
}));

vi.mock('../handlers/events/merger-handler', () => ({
  handlePatchMerge: mockHandlePatchMerge,
}));

// 8. Mock wakeupInitiator
const { mockWakeupInitiator } = vi.hoisted(() => ({
  mockWakeupInitiator: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../handlers/events/shared', () => ({
  wakeupInitiator: mockWakeupInitiator,
}));

// 9. Mock outbound
vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

// 10. Import handlers under test
import { handleResearchTask } from '../handlers/events/research-handler';
import { handleParallelTaskCompleted } from '../handlers/events/parallel-task-completed-handler';
import { AgentType, EventType } from '../lib/types/agent';

describe('Swarm Recursive Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Phase 1: Research Swarm', () => {
    it('should decompose research goal into parallel sub-tasks', async () => {
      mockDecomposePlan.mockReturnValue({
        wasDecomposed: true,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Research Auth0 features',
            agentId: AgentType.RESEARCHER,
            planId: 'task-1',
            gapIds: [],
            order: 0,
            dependencies: [],
            complexity: 5,
          },
          {
            subTaskId: 'sub-1',
            task: 'Research Cognito features',
            agentId: AgentType.RESEARCHER,
            planId: 'task-1',
            gapIds: [],
            order: 1,
            dependencies: [],
            complexity: 5,
          },
        ],
        totalSubTasks: 2,
        originalPlan: 'Research Auth0 vs Cognito',
      });

      await handleResearchTask(
        {
          userId: 'user-1',
          taskId: 'task-1',
          task: 'Research Auth0 vs Cognito',
          metadata: {},
          traceId: 'trace-1',
          initiatorId: AgentType.STRATEGIC_PLANNER,
          depth: 0,
          sessionId: 'session-1',
        },
        {} as any
      );

      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        AgentType.RESEARCHER,
        EventType.PARALLEL_TASK_DISPATCH,
        expect.objectContaining({
          userId: 'user-1',
          tasks: expect.arrayContaining([
            expect.objectContaining({ taskId: 'sub-0' }),
            expect.objectContaining({ taskId: 'sub-1' }),
          ]),
          aggregationType: 'agent_guided',
          depth: 1,
        })
      );
    });

    it('should aggregate research findings and wake up initiator', async () => {
      await handleParallelTaskCompleted({
        userId: 'user-1',
        traceId: 'trace-1',
        initiatorId: AgentType.RESEARCHER,
        overallStatus: 'success',
        results: [
          {
            taskId: 'sub-0',
            agentId: AgentType.RESEARCHER,
            status: 'success',
            result: 'Auth0 findings',
          },
          {
            taskId: 'sub-1',
            agentId: AgentType.RESEARCHER,
            status: 'success',
            result: 'Cognito findings',
          },
        ],
        taskCount: 2,
        completedCount: 2,
        aggregationType: 'agent_guided',
        aggregationPrompt: 'Synthesize research findings',
      });

      expect(mockAgentProcess).not.toHaveBeenCalled();
      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-1',
        AgentType.RESEARCHER,
        expect.stringContaining('[AGGREGATED_RESULTS]'),
        'trace-1',
        undefined,
        1,
        false,
        undefined,
        'trace-1',
        EventType.RESEARCH_TASK
      );
    });
  });

  describe('Phase 2: Coder Swarm', () => {
    it('should aggregate coder patches and trigger merge', async () => {
      await handleParallelTaskCompleted({
        userId: 'user-1',
        traceId: 'trace-2',
        initiatorId: AgentType.CODER,
        overallStatus: 'success',
        results: [
          {
            taskId: 'coder-1',
            agentId: AgentType.CODER,
            status: 'success',
            result: 'PATCH_START\ndiff --git a/file1.ts\nPATCH_END',
            patch: 'diff --git a/file1.ts',
          },
          {
            taskId: 'coder-2',
            agentId: AgentType.CODER,
            status: 'success',
            result: 'PATCH_START\ndiff --git a/file2.ts\nPATCH_END',
            patch: 'diff --git a/file2.ts',
          },
        ],
        taskCount: 2,
        completedCount: 2,
        aggregationType: 'merge_patches',
      });

      expect(mockHandlePatchMerge).toHaveBeenCalled();
    });
  });

  describe('Depth Limit Enforcement', () => {
    it('should not decompose when depth >= 2', async () => {
      mockDecomposePlan.mockReturnValue({
        wasDecomposed: true,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Deep research',
            agentId: AgentType.RESEARCHER,
            planId: 'task-1',
            gapIds: [],
            order: 0,
            dependencies: [],
            complexity: 5,
          },
        ],
        totalSubTasks: 1,
        originalPlan: 'Deep research',
      });

      await handleResearchTask(
        {
          userId: 'user-1',
          taskId: 'task-1',
          task: 'Deep research task',
          metadata: {},
          traceId: 'trace-1',
          initiatorId: AgentType.RESEARCHER,
          depth: 2,
          sessionId: 'session-1',
        },
        {} as any
      );

      // Ensure no PARALLEL_TASK_DISPATCH was emitted (task executed locally)
      expect(mockEmitTypedEvent).not.toHaveBeenCalledWith(
        AgentType.RESEARCHER,
        EventType.PARALLEL_TASK_DISPATCH,
        expect.anything()
      );
      expect(mockAgentProcess).toHaveBeenCalled();
    });
  });

  describe('Error Propagation', () => {
    it('should handle partial failures in parallel results', async () => {
      mockAgentProcess.mockRejectedValueOnce(new Error('Aggregation failed'));

      await handleParallelTaskCompleted({
        userId: 'user-1',
        traceId: 'trace-3',
        initiatorId: AgentType.RESEARCHER,
        overallStatus: 'partial',
        results: [
          {
            taskId: 'sub-0',
            agentId: AgentType.RESEARCHER,
            status: 'success',
            result: 'Success result',
          },
          { taskId: 'sub-1', agentId: AgentType.RESEARCHER, status: 'failed', error: 'Timeout' },
        ],
        taskCount: 2,
        completedCount: 2,
        aggregationType: 'agent_guided',
      });

      expect(mockWakeupInitiator).toHaveBeenCalled();
      const callArg = mockWakeupInitiator.mock.calls[0][2];
      // New format includes details and emojis
      expect(callArg).toContain('❌');
    });
  });
});
