import { vi, describe, it, expect, beforeEach } from 'vitest';
import { handleParallelTaskCompleted } from './parallel-task-completed-handler';

// Mocking needed for Agent invocation
const { mockAgentProcess, AgentMock } = vi.hoisted(() => ({
  mockAgentProcess: vi.fn().mockResolvedValue({ responseText: 'Synthesized Next Action' }),
  AgentMock: vi.fn().mockImplementation(function (this: any) {
    this.process = mockAgentProcess;
  }),
}));

vi.mock('../../lib/agent', () => ({
  Agent: AgentMock,
}));

vi.mock('../../agents/superclaw', () => ({
  SuperClaw: AgentMock,
}));

vi.mock('../../lib/utils/agent-helpers', () => ({
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

const { mockWakeupInitiator } = vi.hoisted(() => ({
  mockWakeupInitiator: vi.fn().mockResolvedValue({}),
}));

vi.mock('./shared', () => ({
  wakeupInitiator: mockWakeupInitiator,
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../lib/registry/AgentRegistry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      name: 'SuperClaw',
      systemPrompt: 'Aggregator prompt',
    }),
  },
}));

vi.mock('../../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

describe('Parallel Failure Robustness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a recovery plan when 100% of tasks fail', async () => {
    const failureEvent = {
      userId: 'user-1',
      traceId: 'trace-fail',
      initiatorId: 'superclaw',
      overallStatus: 'failed',
      results: [
        { taskId: 'task-1', agentId: 'coder', status: 'failed', error: 'AST Parse Error' },
        { taskId: 'task-2', agentId: 'coder', status: 'failed', error: 'Unreachable' },
      ],
      taskCount: 2,
      completedCount: 2,
      aggregationType: 'agent_guided',
      aggregationPrompt: 'CRITICAL FAILURE - Generate RECOVERY PLAN',
    };

    await handleParallelTaskCompleted(failureEvent as any);

    // Verify synthesizer was called with error details
    const aggregatorPrompt = mockAgentProcess.mock.calls[0][1];
    expect(aggregatorPrompt).toContain('AST Parse Error');
    expect(aggregatorPrompt).toContain('RECOVERY PLAN');

    // Verify initiator was woken up with the recovery plan
    expect(mockWakeupInitiator).toHaveBeenCalledWith(
      'user-1',
      'superclaw',
      'Synthesized Next Action',
      'trace-fail',
      'default-session',
      0,
      false,
      undefined,
      'trace-fail',
      'continuation_task',
      undefined,
      undefined,
      undefined
    );
  });

  it('handles timed_out tasks correctly in synthesis', async () => {
    const timeoutEvent = {
      userId: 'user-1',
      traceId: 'trace-timeout',
      initiatorId: 'superclaw',
      overallStatus: 'failed',
      results: [
        { taskId: 'task-1', agentId: 'coder', status: 'success', result: 'Partial work' },
        { taskId: 'task-2', agentId: 'coder', status: 'timed_out', error: 'Barrier timeout' },
      ],
      taskCount: 2,
      completedCount: 2,
      aggregationType: 'agent_guided',
      aggregationPrompt: 'Synthesis including timed out tasks',
    };

    await handleParallelTaskCompleted(timeoutEvent as any);

    const aggregatorPrompt = mockAgentProcess.mock.calls[0][1];
    expect(aggregatorPrompt).toContain('Partial work');
    expect(aggregatorPrompt).toContain('timed out');

    expect(mockWakeupInitiator).toHaveBeenCalled();
  });
});
