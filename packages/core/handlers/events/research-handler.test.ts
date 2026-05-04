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

// 2. Mock decomposer
const { mockDecomposePlan } = vi.hoisted(() => ({
  mockDecomposePlan: vi.fn(),
}));

vi.mock('../../lib/agent/decomposer', () => ({
  decomposePlan: mockDecomposePlan,
}));

// 3. Mock typed-emit
const { mockEmitTypedEvent, mockEmitTaskCompleted, mockEmitTaskFailed } = vi.hoisted(() => ({
  mockEmitTypedEvent: vi.fn().mockResolvedValue(undefined),
  mockEmitTaskCompleted: vi.fn().mockResolvedValue(undefined),
  mockEmitTaskFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/utils/typed-emit', () => ({
  emitTypedEvent: mockEmitTypedEvent,
  emitTaskCompleted: mockEmitTaskCompleted,
  emitTaskFailed: mockEmitTaskFailed,
}));

// 4. Mock Agent process, init and config (stub `initAgent` to avoid touching SST/Dynamo)
const { mockAgentProcess, memoryMock, mockInitAgent, mockLoadAgentConfig, mockGetAgentTools } =
  vi.hoisted(() => {
    const mockAgentProcess = vi.fn().mockResolvedValue({
      responseText: 'Research synthesis complete',
      attachments: [],
    });

    const memoryMock = {
      addMemory: vi.fn().mockResolvedValue(1),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
    } as any;

    return {
      mockAgentProcess,
      memoryMock,
      mockInitAgent: vi.fn().mockResolvedValue({
        memory: memoryMock,
        agent: { process: mockAgentProcess },
      }),
      mockLoadAgentConfig: vi.fn().mockResolvedValue({
        systemPrompt: 'Researcher prompt',
        tools: ['web_search', 'fetch'],
      }),
      mockGetAgentTools: vi.fn().mockResolvedValue(['web_search', 'fetch', 'filesystem']),
    };
  });

vi.mock('../../lib/utils/agent-helpers', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    initAgent: mockInitAgent,
    loadAgentConfig: mockLoadAgentConfig,
    getAgentTools: mockGetAgentTools,
  };
});

vi.mock('../../lib/agent', () => {
  return {
    Agent: vi.fn().mockImplementation(function () {
      return {
        process: mockAgentProcess,
      };
    }),
  };
});

// 6. Mock schema
vi.mock('../../lib/schema/events', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    RESEARCH_TASK_METADATA: {
      parse: vi.fn().mockReturnValue({
        tokenBudget: 100000,
        timeBudgetMs: 600000,
      }),
    },
  };
});

// 6b. Mock tools index (heavy module that causes timeouts)
vi.mock('../../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue(['web_search', 'fetch']),
}));

// 7. Import code under test
import { handleResearchTask } from './research-handler';
import { AGENT_TYPES, EventType } from '../../lib/types/agent';

describe('research-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('aggregation detection', () => {
    it('should detect [AGGREGATED_RESULTS] and skip decomposition', async () => {
      const eventDetail = {
        userId: 'user-1',
        taskId: 'task-1',
        task: '[AGGREGATED_RESULTS] Some aggregated findings',
        metadata: {},
        traceId: 'trace-1',
        initiatorId: AGENT_TYPES.RESEARCHER,
        depth: 1,
        sessionId: 'session-1',
      };

      await handleResearchTask(eventDetail, {} as any);

      // Should NOT decompose
      expect(mockDecomposePlan).not.toHaveBeenCalled();

      // Should NOT dispatch parallel tasks
      expect(mockEmitTypedEvent).not.toHaveBeenCalledWith(
        AGENT_TYPES.RESEARCHER,
        EventType.PARALLEL_TASK_DISPATCH,
        expect.anything()
      );

      expect(mockAgentProcess).toHaveBeenCalledWith(
        'user-1',
        '[AGGREGATED_RESULTS] Some aggregated findings',
        expect.anything()
      );
    });

    it('should process normal task without aggregation tag', async () => {
      const eventDetail = {
        userId: 'user-1',
        taskId: 'task-1',
        task: 'Research authentication patterns',
        metadata: {},
        traceId: 'trace-1',
        initiatorId: AGENT_TYPES.RESEARCHER,
        depth: 1,
        sessionId: 'session-1',
      };

      mockDecomposePlan.mockReturnValue({
        wasDecomposed: false,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Research authentication patterns',
            agentId: AGENT_TYPES.RESEARCHER,
            planId: 'plan-1',
            gapIds: [],
            order: 0,
            dependencies: [],
            complexity: 3,
          },
        ],
        totalSubTasks: 1,
        originalPlan: 'Research authentication patterns',
      });

      await handleResearchTask(eventDetail, {} as any);

      // initAgent is stubbed; ensure the agent processed the task
      expect(mockAgentProcess).toHaveBeenCalledWith(
        'user-1',
        'Research authentication patterns',
        expect.objectContaining({
          taskTimeoutMs: 600000,
        })
      );
    });
  });

  describe('recursive decomposition', () => {
    it('should decompose high-level goals into parallel sub-tasks', async () => {
      const eventDetail = {
        userId: 'user-1',
        taskId: 'task-1',
        task: 'Research Auth0 vs Cognito for authentication',
        metadata: {},
        traceId: 'trace-1',
        initiatorId: AGENT_TYPES.RESEARCHER,
        depth: 1,
        sessionId: 'session-1',
      };

      mockDecomposePlan.mockReturnValue({
        wasDecomposed: true,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Research Auth0 features',
            agentId: AGENT_TYPES.RESEARCHER,
            planId: 'task-1',
            gapIds: [],
            order: 0,
            dependencies: [],
            complexity: 5,
          },
          {
            subTaskId: 'sub-1',
            task: 'Research Cognito features',
            agentId: AGENT_TYPES.RESEARCHER,
            planId: 'task-1',
            gapIds: [],
            order: 1,
            dependencies: [],
            complexity: 5,
          },
        ],
        totalSubTasks: 2,
        originalPlan: 'Research Auth0 vs Cognito for authentication',
      });

      await handleResearchTask(eventDetail, {} as any);

      const expectedPlanId = eventDetail.taskId || eventDetail.traceId;
      expect(mockDecomposePlan).toHaveBeenCalledWith(
        'Research Auth0 vs Cognito for authentication',
        expectedPlanId,
        [],
        expect.objectContaining({
          defaultAgentId: AGENT_TYPES.RESEARCHER,
          maxSubTasks: 4,
          minLength: 300,
        })
      );

      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        AGENT_TYPES.RESEARCHER,
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

      expect(mockAgentProcess).not.toHaveBeenCalled();
    });

    it('should not decompose when depth >= SWARM.MAX_RECURSIVE_DEPTH', async () => {
      const eventDetail = {
        userId: 'user-1',
        taskId: 'task-1',
        task: 'Research something deep',
        metadata: {},
        traceId: 'trace-1',
        initiatorId: AGENT_TYPES.RESEARCHER,
        depth: 15,
        sessionId: 'session-1',
      };

      await handleResearchTask(eventDetail, {} as any);

      expect(mockDecomposePlan).not.toHaveBeenCalled();
      expect(mockAgentProcess).toHaveBeenCalled();
    });

    it('should not decompose when decomposition returns single task', async () => {
      const eventDetail = {
        userId: 'user-1',
        taskId: 'task-1',
        task: 'Research something simple',
        metadata: {},
        traceId: 'trace-1',
        initiatorId: AGENT_TYPES.RESEARCHER,
        depth: 1,
        sessionId: 'session-1',
      };

      mockDecomposePlan.mockReturnValue({
        wasDecomposed: false,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Research something simple',
            agentId: AGENT_TYPES.RESEARCHER,
            planId: 'task-1',
            gapIds: [],
            order: 0,
            dependencies: [],
            complexity: 3,
          },
        ],
        totalSubTasks: 1,
        originalPlan: 'Research something simple',
      });

      await handleResearchTask(eventDetail, {} as any);

      expect(mockAgentProcess).toHaveBeenCalled();
    });
  });

  describe('task completion', () => {
    it('should emit task completed event on success', async () => {
      const eventDetail = {
        userId: 'user-1',
        taskId: 'task-1',
        task: 'Research authentication',
        metadata: {},
        traceId: 'trace-1',
        initiatorId: AGENT_TYPES.RESEARCHER,
        depth: 1,
        sessionId: 'session-1',
      };

      mockDecomposePlan.mockReturnValue({
        wasDecomposed: false,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Research authentication',
            agentId: AGENT_TYPES.RESEARCHER,
            planId: 'task-1',
            gapIds: [],
            order: 0,
            dependencies: [],
            complexity: 3,
          },
        ],
        totalSubTasks: 1,
        originalPlan: 'Research authentication',
      });

      await handleResearchTask(eventDetail, {} as any);

      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        expect.any(String),
        EventType.TASK_COMPLETED,
        expect.objectContaining({
          userId: 'user-1',
          agentId: AGENT_TYPES.RESEARCHER,
          task: 'Research authentication',
          traceId: 'trace-1',
          depth: 1,
          metadata: expect.objectContaining({
            findingsCategory: 'research_finding',
          }),
        }),
        expect.anything()
      );
    });

    it('should store research findings in memory', async () => {
      const eventDetail = {
        userId: 'user-1',
        taskId: 'task-1',
        task: 'Research authentication',
        metadata: {},
        traceId: 'trace-1',
        initiatorId: AGENT_TYPES.RESEARCHER,
        depth: 1,
        sessionId: 'session-1',
      };

      mockDecomposePlan.mockReturnValue({
        wasDecomposed: false,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Research authentication',
            agentId: AGENT_TYPES.RESEARCHER,
            planId: 'task-1',
            gapIds: [],
            order: 0,
            dependencies: [],
            complexity: 3,
          },
        ],
        totalSubTasks: 1,
        originalPlan: 'Research authentication',
      });

      const memory = memoryMock;

      await handleResearchTask(eventDetail, {} as any);

      expect(memory.addMemory).toHaveBeenCalledWith(
        'user-1',
        'research_finding',
        'Research synthesis complete',
        expect.objectContaining({
          category: 'research_finding',
          tags: ['trace-1', 'task-1', 'synthesis'],
        })
      );
    });
  });

  describe('error handling', () => {
    it('should emit task failed event on error', async () => {
      mockAgentProcess.mockRejectedValueOnce(new Error('Research failed'));

      const eventDetail = {
        userId: 'user-1',
        taskId: 'task-1',
        task: 'Research authentication',
        metadata: {},
        traceId: 'trace-1',
        initiatorId: AGENT_TYPES.RESEARCHER,
        depth: 0,
        sessionId: 'session-1',
      };

      mockDecomposePlan.mockReturnValue({
        wasDecomposed: false,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Research authentication',
            agentId: AGENT_TYPES.RESEARCHER,
            planId: 'task-1',
            gapIds: [],
            order: 0,
            dependencies: [],
            complexity: 3,
          },
        ],
        totalSubTasks: 1,
        originalPlan: 'Research authentication',
      });

      await expect(handleResearchTask(eventDetail, {} as any)).rejects.toThrow('Research failed');

      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        expect.any(String),
        EventType.TASK_FAILED,
        expect.objectContaining({
          userId: 'user-1',
          error: expect.stringContaining('Research failed'),
        }),
        expect.anything()
      );
    });
  });
});
