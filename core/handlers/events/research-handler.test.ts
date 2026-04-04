import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

// 4. Mock agent context and config
const { mockGetAgentContext, mockLoadAgentConfig, mockGetAgentTools } = vi.hoisted(() => ({
  mockGetAgentContext: vi.fn().mockResolvedValue({
    memory: {
      addMemory: vi.fn().mockResolvedValue(1),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
    },
    provider: {},
  }),
  mockLoadAgentConfig: vi.fn().mockResolvedValue({
    systemPrompt: 'Researcher prompt',
    tools: ['web_search', 'fetch'],
  }),
  mockGetAgentTools: vi.fn().mockResolvedValue(['web_search', 'fetch', 'filesystem']),
}));

vi.mock('../../lib/utils/agent-helpers', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getAgentContext: mockGetAgentContext,
    loadAgentConfig: mockLoadAgentConfig,
    getAgentTools: mockGetAgentTools,
  };
});

// 5. Mock Agent
const { mockAgentProcess } = vi.hoisted(() => ({
  mockAgentProcess: vi.fn().mockResolvedValue({
    responseText: 'Research synthesis complete',
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

// 6. Mock schema
vi.mock('../../lib/schema/events', () => ({
  RESEARCH_TASK_METADATA: {
    parse: vi.fn().mockReturnValue({
      tokenBudget: 100000,
      timeBudgetMs: 300000,
    }),
  },
}));

// 6b. Mock tools index (heavy module that causes timeouts)
vi.mock('../../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue(['web_search', 'fetch']),
}));

// 7. Import code under test
import { handleResearchTask } from './research-handler';
import { AgentType, EventType } from '../../lib/types/agent';

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
        initiatorId: AgentType.RESEARCHER,
        depth: 0,
        sessionId: 'session-1',
      };

      await handleResearchTask(eventDetail);

      expect(mockDecomposePlan).not.toHaveBeenCalled();
      expect(mockEmitTypedEvent).not.toHaveBeenCalled();
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
        initiatorId: AgentType.RESEARCHER,
        depth: 0,
        sessionId: 'session-1',
      };

      mockDecomposePlan.mockReturnValue({
        wasDecomposed: false,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Research authentication patterns',
            agentId: AgentType.RESEARCHER,
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

      await handleResearchTask(eventDetail);

      expect(mockAgentProcess).toHaveBeenCalled();
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
        initiatorId: AgentType.RESEARCHER,
        depth: 0,
        sessionId: 'session-1',
      };

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
        originalPlan: 'Research Auth0 vs Cognito for authentication',
      });

      await handleResearchTask(eventDetail);

      expect(mockDecomposePlan).toHaveBeenCalledWith(
        'Research Auth0 vs Cognito for authentication',
        'task-1',
        [],
        expect.objectContaining({
          defaultAgentId: AgentType.RESEARCHER,
          maxSubTasks: 4,
          minLength: 300,
        })
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

      expect(mockAgentProcess).not.toHaveBeenCalled();
    });

    it('should not decompose when depth >= 2', async () => {
      const eventDetail = {
        userId: 'user-1',
        taskId: 'task-1',
        task: 'Research something deep',
        metadata: {},
        traceId: 'trace-1',
        initiatorId: AgentType.RESEARCHER,
        depth: 2,
        sessionId: 'session-1',
      };

      await handleResearchTask(eventDetail);

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
        initiatorId: AgentType.RESEARCHER,
        depth: 0,
        sessionId: 'session-1',
      };

      mockDecomposePlan.mockReturnValue({
        wasDecomposed: false,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Research something simple',
            agentId: AgentType.RESEARCHER,
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

      await handleResearchTask(eventDetail);

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
        initiatorId: AgentType.RESEARCHER,
        depth: 0,
        sessionId: 'session-1',
      };

      mockDecomposePlan.mockReturnValue({
        wasDecomposed: false,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Research authentication',
            agentId: AgentType.RESEARCHER,
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

      await handleResearchTask(eventDetail);

      expect(mockEmitTaskCompleted).toHaveBeenCalledWith(
        AgentType.RESEARCHER,
        expect.objectContaining({
          userId: 'user-1',
          agentId: AgentType.RESEARCHER,
          task: 'Research authentication',
          traceId: 'trace-1',
          metadata: expect.objectContaining({
            findingsCategory: 'research_finding',
          }),
        })
      );
    });

    it('should store research findings in memory', async () => {
      const eventDetail = {
        userId: 'user-1',
        taskId: 'task-1',
        task: 'Research authentication',
        metadata: {},
        traceId: 'trace-1',
        initiatorId: AgentType.RESEARCHER,
        depth: 0,
        sessionId: 'session-1',
      };

      mockDecomposePlan.mockReturnValue({
        wasDecomposed: false,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Research authentication',
            agentId: AgentType.RESEARCHER,
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

      const { memory } = await mockGetAgentContext();

      await handleResearchTask(eventDetail);

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
        initiatorId: AgentType.RESEARCHER,
        depth: 0,
        sessionId: 'session-1',
      };

      mockDecomposePlan.mockReturnValue({
        wasDecomposed: false,
        subTasks: [
          {
            subTaskId: 'sub-0',
            task: 'Research authentication',
            agentId: AgentType.RESEARCHER,
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

      await handleResearchTask(eventDetail);

      expect(mockEmitTaskFailed).toHaveBeenCalledWith(
        AgentType.RESEARCHER,
        expect.objectContaining({
          userId: 'user-1',
          error: expect.stringContaining('Research failed'),
        })
      );
    });
  });
});
