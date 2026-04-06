import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handleParallelTaskCompleted } from '../handlers/events/parallel-task-completed-handler';

// Mocking needed for Agent invocation
const mockAgentProcess = vi.fn().mockResolvedValue({ responseText: 'Synthesized Next Action' });
const AgentMock = vi.fn().mockImplementation(function (this: any) {
  this.process = mockAgentProcess;
});

vi.mock('../lib/agent', () => ({
  Agent: AgentMock,
}));

vi.mock('../lib/utils/agent-helpers', () => ({
  getAgentContext: vi.fn().mockResolvedValue({
    memory: {},
    provider: {},
  }),
  loadAgentConfig: vi.fn().mockResolvedValue({
    name: 'SuperClaw',
    systemPrompt: 'You are an aggregator.',
  }),
  isTaskPaused: vi.fn().mockReturnValue(false),
}));

vi.mock('../handlers/events/shared', () => ({
  wakeupInitiator: vi.fn().mockResolvedValue({}),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockHandlePatchMerge = vi.fn().mockResolvedValue(undefined);
vi.mock('../handlers/events/merger-handler', () => ({
  handlePatchMerge: mockHandlePatchMerge,
}));

describe('Parallel Aggregation Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should trigger agent-guided aggregation when requested', async () => {
    const eventDetail = {
      userId: 'user-123',
      traceId: 'trace-456',
      initiatorId: 'strategic-planner',
      overallStatus: 'success',
      results: [{ taskId: 't1', agentId: 'a1', status: 'success', result: 'Result 1' }],
      taskCount: 1,
      completedCount: 1,
      aggregationType: 'agent_guided',
      aggregationPrompt: 'Custom synthesis prompt',
    };

    await handleParallelTaskCompleted(eventDetail as any);

    const { wakeupInitiator } = await import('../handlers/events/shared');
    expect(wakeupInitiator).toHaveBeenCalledWith(
      'user-123',
      'strategic-planner',
      'Synthesized Next Action',
      'trace-456',
      undefined,
      1,
      false,
      undefined,
      'trace-456'
    );
  });

  it('should fallback to summary if agent-guided fails', async () => {
    AgentMock.mockImplementationOnce(() => ({
      process: vi.fn().mockRejectedValue(new Error('LLM Error')),
    }));

    const eventDetail = {
      userId: 'user-123',
      traceId: 'trace-456',
      initiatorId: 'strategic-planner',
      overallStatus: 'success',
      results: [{ taskId: 't1', agentId: 'a1', status: 'success', result: 'Result 1' }],
      taskCount: 1,
      completedCount: 1,
      aggregationType: 'agent_guided',
    };

    await handleParallelTaskCompleted(eventDetail as any);

    const { wakeupInitiator } = await import('../handlers/events/shared');
    expect(wakeupInitiator).toHaveBeenCalledWith(
      'user-123',
      'strategic-planner',
      expect.stringContaining('Parallel Dispatch Complete'),
      'trace-456',
      undefined,
      1,
      false,
      undefined,
      'trace-456'
    );
  });

  it('should trigger patch merge when aggregationType is merge_patches', async () => {
    const eventDetail = {
      userId: 'user-123',
      traceId: 'trace-456',
      initiatorId: 'superclaw',
      sessionId: 'session-789',
      overallStatus: 'success',
      results: [
        {
          taskId: 't1',
          agentId: 'coder-a',
          status: 'success',
          result: 'Done',
          patch: 'diff --git a/file.ts b/file.ts\n+change',
        },
      ],
      taskCount: 1,
      completedCount: 1,
      aggregationType: 'merge_patches',
    };

    await handleParallelTaskCompleted(eventDetail as any);

    expect(mockHandlePatchMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregationType: 'merge_patches',
        traceId: 'trace-456',
      })
    );
  });

  it('should fallback to summary if patch merge fails', async () => {
    mockHandlePatchMerge.mockRejectedValueOnce(new Error('Merge failed'));

    const eventDetail = {
      userId: 'user-123',
      traceId: 'trace-456',
      initiatorId: 'strategic-planner',
      overallStatus: 'success',
      results: [{ taskId: 't1', agentId: 'a1', status: 'success', result: 'Result 1' }],
      taskCount: 1,
      completedCount: 1,
      aggregationType: 'merge_patches',
    };

    await handleParallelTaskCompleted(eventDetail as any);

    const { wakeupInitiator } = await import('../handlers/events/shared');
    expect(wakeupInitiator).toHaveBeenCalledWith(
      'user-123',
      'strategic-planner',
      expect.stringContaining('Parallel Dispatch Complete'),
      'trace-456',
      undefined,
      1,
      false,
      undefined,
      'trace-456'
    );
  });
});
