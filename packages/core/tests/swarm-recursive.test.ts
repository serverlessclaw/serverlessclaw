import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handleParallelTaskCompleted } from '../handlers/events/parallel-task-completed-handler';

// 1. Mock Logger
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// 2. Mock Agent Logic
const { mockAgentProcess } = vi.hoisted(() => ({
  mockAgentProcess: vi.fn().mockResolvedValue({
    responseText: 'Synthesized result',
    attachments: [],
  }),
}));

vi.mock('../agents/superclaw', () => ({
  SuperClaw: vi.fn().mockImplementation(function () {
    return { process: mockAgentProcess };
  }),
}));

vi.mock('../agents/researcher', () => ({
  ResearcherAgent: vi.fn().mockImplementation(function () {
    return { process: mockAgentProcess };
  }),
}));

vi.mock('../lib/agent', () => ({
  Agent: vi.fn().mockImplementation(function () {
    return { process: mockAgentProcess };
  }),
}));

// 3. Mock shared functions
const { mockWakeupInitiator, mockProcessEventWithAgent } = vi.hoisted(() => ({
  mockWakeupInitiator: vi.fn().mockResolvedValue(undefined),
  mockProcessEventWithAgent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../handlers/events/shared', () => ({
  wakeupInitiator: mockWakeupInitiator,
  handleRecursionLimitExceeded: vi.fn().mockResolvedValue(undefined),
  processEventWithAgent: mockProcessEventWithAgent,
}));

// 4. Mock merger-handler
const { mockHandlePatchMerge } = vi.hoisted(() => ({
  mockHandlePatchMerge: vi.fn().mockResolvedValue({
    success: true,
    summary: 'Merge complete',
  }),
}));

vi.mock('../handlers/events/merger-handler', () => ({
  handlePatchMerge: mockHandlePatchMerge,
}));

// 5. Mock registry and helpers
vi.mock('../lib/registry/AgentRegistry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      id: 'researcher',
      name: 'Researcher',
      enabled: true,
    }),
    getToolsForAgent: vi.fn().mockResolvedValue([]),
    getFallbackAgents: vi.fn().mockReturnValue(['researcher']),
  },
}));

vi.mock('../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/utils/agent-helpers', async () => {
  const actual = await vi.importActual('../lib/utils/agent-helpers');
  return {
    ...actual,
    getAgentContext: vi.fn().mockResolvedValue({ memory: {}, provider: {} }),
    isTaskPaused: vi.fn().mockReturnValue(false),
  };
});

describe('Swarm Recursive Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Phase 1: Research Swarm', () => {
    it('should aggregate research findings and wake up initiator', async () => {
      const eventDetail = {
        userId: 'user-1',
        traceId: 'trace-1',
        initiatorId: 'researcher',
        sessionId: 'default-session',
        overallStatus: 'success',
        taskCount: 2,
        completedCount: 2,
        results: [
          { taskId: 'sub-0', agentId: 'researcher', status: 'success', result: 'Auth0 findings' },
          { taskId: 'sub-1', agentId: 'researcher', status: 'success', result: 'Cognito findings' },
        ],
        aggregationType: 'agent_guided',
        aggregationPrompt: 'Synthesize research findings',
      };

      await handleParallelTaskCompleted(eventDetail as any);

      // Verify synthesizer was called with correctly scoped options
      expect(mockAgentProcess).toHaveBeenCalledWith(
        'user-1',
        expect.stringContaining('Synthesize research findings'),
        expect.objectContaining({
          traceId: 'trace-1',
          sessionId: 'default-session',
          isIsolated: true,
          staffId: undefined,
          teamId: undefined,
          workspaceId: undefined,
        })
      );

      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-1',
        'researcher',
        'Synthesized result',
        'trace-1',
        'default-session',
        0,
        false,
        undefined,
        'trace-1',
        'continuation_task',
        undefined,
        undefined,
        undefined
      );
    });
  });

  describe('Phase 2: Coder Swarm', () => {
    it('should aggregate coder patches and trigger merge', async () => {
      const eventDetail = {
        userId: 'user-1',
        traceId: 'trace-1',
        initiatorId: 'superclaw',
        sessionId: 'session-1',
        overallStatus: 'success',
        taskCount: 1,
        completedCount: 1,
        aggregationType: 'merge_patches',
        results: [{ taskId: 'sub-0', agentId: 'coder', status: 'success', result: 'Patch 1' }],
      };

      await handleParallelTaskCompleted(eventDetail as any);

      expect(mockHandlePatchMerge).toHaveBeenCalled();
      expect(mockWakeupInitiator).toHaveBeenCalledWith(
        'user-1',
        'superclaw',
        'Merge complete',
        'trace-1',
        'session-1',
        0,
        false,
        undefined,
        'trace-1',
        'continuation_task',
        undefined,
        undefined,
        undefined
      );
    });
  });

  describe('Error Propagation', () => {
    it('should handle partial failures in parallel results', async () => {
      const eventDetail = {
        userId: 'user-1',
        traceId: 'trace-1',
        initiatorId: 'superclaw',
        sessionId: 'session-1',
        overallStatus: 'failed',
        taskCount: 2,
        completedCount: 2,
        results: [
          { taskId: 'sub-0', agentId: 'researcher', status: 'success', result: 'Success result' },
          { taskId: 'sub-1', agentId: 'researcher', status: 'failed', error: 'Timeout' },
        ],
      };

      await handleParallelTaskCompleted(eventDetail as any);

      const callArg = mockWakeupInitiator.mock.calls[0][2];
      expect(callArg).toContain('[AGGREGATED_RESULTS]');
      expect(callArg).toContain('Agent researcher (success): Success result');
      expect(callArg).toContain('Agent researcher (failed): Timeout');
    });
  });

  describe('Depth Limit Enforcement', () => {
    it('should not decompose when depth >= 2', async () => {
      // Mock handleContinuationTask directly to test its internal branching
      const event = {
        detail: {
          userId: 'user-1',
          task: 'Deep research task',
          depth: 2,
          traceId: 'trace-1',
          taskId: 'task-1',
          initiatorId: 'researcher',
          sessionId: 'session-1',
        },
      };

      const { handleContinuationTask } = await import('../handlers/events/continuation-handler');
      await handleContinuationTask(event.detail as any, {} as any);

      expect(mockProcessEventWithAgent).toHaveBeenCalledWith(
        'user-1',
        expect.anything(),
        'Deep research task',
        expect.objectContaining({
          depth: 2,
          traceId: 'trace-1',
          taskId: 'task-1',
          initiatorId: 'researcher',
          sessionId: 'session-1',
        })
      );
    });
  });
});
