import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handleParallelTaskCompleted } from './parallel-task-completed-handler';

// Mock Logger
vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock wakeupInitiator
const { mockWakeupInitiator } = vi.hoisted(() => ({
  mockWakeupInitiator: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./shared', () => ({
  wakeupInitiator: mockWakeupInitiator,
}));

// Mock Agent
const { mockAgentProcess } = vi.hoisted(() => ({
  mockAgentProcess: vi.fn(),
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

// Mock agent-helpers
vi.mock('../../lib/utils/agent-helpers', () => ({
  getAgentContext: vi.fn(async () => ({ memory: {}, provider: {} })),
  loadAgentConfig: vi.fn(async () => ({ id: 'superclaw', systemPrompt: '...' })),
}));

describe('Parallel Failure Robustness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a recovery plan when 100% of tasks fail', async () => {
    const failedEvent = {
      userId: 'user-1',
      traceId: 'trace-fail',
      initiatorId: 'superclaw',
      overallStatus: 'failed' as const,
      results: [
        { taskId: 'task-1', agentId: 'coder', status: 'failed', error: 'AST Parse Error' },
        { taskId: 'task-2', agentId: 'coder', status: 'failed', error: 'Unreachable' },
      ],
      taskCount: 2,
      completedCount: 2,
      aggregationType: 'agent_guided' as const,
    };

    mockAgentProcess.mockResolvedValue({
      responseText: 'RECOVERY_PLAN: All tasks failed. I suggest retrying with reduced scope.',
    });

    await handleParallelTaskCompleted(failedEvent as any);

    // Verify synthesizer was called with error details
    const aggregatorPrompt = mockAgentProcess.mock.calls[0][1];
    expect(aggregatorPrompt).toContain('AST Parse Error');
    expect(aggregatorPrompt).toContain('RECOVERY PLAN');

    // Verify initiator was woken up with the recovery plan
    expect(mockWakeupInitiator).toHaveBeenCalledWith(
      'user-1',
      'superclaw',
      'RECOVERY_PLAN: All tasks failed. I suggest retrying with reduced scope.',
      'trace-fail',
      undefined,
      1,
      false,
      undefined,
      'trace-fail'
    );
  });

  it('handles timed_out tasks correctly in synthesis', async () => {
    const timeoutEvent = {
      userId: 'user-1',
      traceId: 'trace-timeout',
      initiatorId: 'superclaw',
      overallStatus: 'timed_out' as const,
      results: [
        { taskId: 'task-1', agentId: 'coder', status: 'success', result: 'Partial work' },
        { taskId: 'task-2', agentId: 'coder', status: 'timed_out', error: 'Barrier timeout' },
      ],
      taskCount: 2,
      completedCount: 2,
      aggregationType: 'agent_guided' as const,
    };

    mockAgentProcess.mockResolvedValue({
      responseText: 'The work was partially completed but Task 2 timed out.',
    });

    await handleParallelTaskCompleted(timeoutEvent as any);

    const aggregatorPrompt = mockAgentProcess.mock.calls[0][1];
    expect(aggregatorPrompt).toContain('Partial work');
    expect(aggregatorPrompt).toContain('timed out');

    expect(mockWakeupInitiator).toHaveBeenCalled();
  });
});
