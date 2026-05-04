import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  signalOrchestration,
  triggerBatchEvolution,
  requestConsensus,
  voteOnProposal,
} from './orchestration';
import { AgentStatus, AGENT_TYPES } from '../../lib/types/agent';
import { logger } from '../../lib/logger';

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../lib/utils/error', () => ({
  formatErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const mocks = vi.hoisted(() => ({
  getDistilledMemory: vi.fn().mockResolvedValue('implement feature X'),
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function () {
    return {
      getDistilledMemory: mocks.getDistilledMemory,
      updateGapStatus: mocks.updateGapStatus,
    };
  }),
}));

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

const { mockEmitTypedEvent } = vi.hoisted(() => ({
  mockEmitTypedEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/utils/typed-emit', () => ({
  emitTypedEvent: (...args: unknown[]) => mockEmitTypedEvent(...args),
}));

describe('signalOrchestration Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully emit a SUCCESS signal', async () => {
    const args = {
      status: AgentStatus.SUCCESS,
      reasoning: 'The task was completed according to requirements.',
      nextStep: 'Notify the user of completion.',
      targetAgentId: AGENT_TYPES.SUPERCLAW,
    };

    const result = await signalOrchestration.execute(args);

    expect(result).toContain('ORCHESTRATION_SIGNAL_EMITTED: SUCCESS');
    expect(result).toContain('Reasoning: The task was completed according to requirements.');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('SUCCESS'));
  });

  it('should successfully emit a PIVOT signal with target agent', async () => {
    const args = {
      status: AgentStatus.PIVOT,
      reasoning: 'The task requires deep architectural analysis.',
      nextStep: 'Analyze the system topology for bottlenecks.',
      targetAgentId: AGENT_TYPES.STRATEGIC_PLANNER,
    };

    const result = await signalOrchestration.execute(args);

    expect(result).toContain('ORCHESTRATION_SIGNAL_EMITTED: PIVOT');
    expect(result).toContain('Target Agent: strategic-planner');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('PIVOT'));
  });

  it('should successfully emit an ESCALATE signal', async () => {
    const args = {
      status: AgentStatus.ESCALATE,
      reasoning: 'The user requested a change to a protected system file.',
      nextStep: 'Ask the user for manual approval to modify core/lib/auth.ts',
      targetAgentId: AGENT_TYPES.SUPERCLAW,
    };

    const result = await signalOrchestration.execute(args);

    expect(result).toContain('ORCHESTRATION_SIGNAL_EMITTED: ESCALATE');
    expect(result).toContain('Next Step: Ask the user for manual approval');
  });

  it('should not include nextStep when not provided', async () => {
    const args = {
      status: AgentStatus.FAILED,
      reasoning: 'Task failed due to timeout.',
      nextStep: undefined,
      targetAgentId: undefined,
    };

    const result = await signalOrchestration.execute(args);

    expect(result).toContain('ORCHESTRATION_SIGNAL_EMITTED: FAILED');
    expect(result).not.toContain('Next Step');
    expect(result).not.toContain('Target Agent');
  });

  it('should include target agent when provided', async () => {
    const args = {
      status: AgentStatus.RETRY,
      reasoning: 'Retry needed.',
      targetAgentId: AGENT_TYPES.CODER,
    };

    const result = await signalOrchestration.execute(args);

    expect(result).toContain('Target Agent: coder');
  });

  it('should log reasoning', async () => {
    const args = {
      status: AgentStatus.SUCCESS,
      reasoning: 'Everything works.',
    };

    await signalOrchestration.execute(args);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Everything works.'));
  });
});

describe('triggerBatchEvolution Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should dispatch gaps with plans to Coder agent', async () => {
    const { emitEvent } = await import('../../lib/utils/bus');
    mocks.getDistilledMemory.mockResolvedValue('implement feature X');

    const result = await triggerBatchEvolution.execute({
      gapIds: ['GAP#100', 'GAP#200'],
    });

    expect(result).toContain('Batch evolution complete for 2 gaps');
    expect(result).toContain('GAP#100: dispatched to Coder');
    expect(result).toContain('GAP#200: dispatched to Coder');
    expect(emitEvent).toHaveBeenCalledTimes(2);
    expect(mocks.updateGapStatus).toHaveBeenCalledWith('GAP#100', 'PROGRESS');
    expect(mocks.updateGapStatus).toHaveBeenCalledWith('GAP#200', 'PROGRESS');
  });

  it('should skip gaps without plans', async () => {
    mocks.getDistilledMemory.mockResolvedValue(null);

    const result = await triggerBatchEvolution.execute({
      gapIds: ['GAP#300'],
    });

    expect(result).toContain('GAP#300: SKIPPED (no plan found)');
  });

  it('should fail when no gapIds provided', async () => {
    const result = await triggerBatchEvolution.execute({ gapIds: [] });
    expect(result).toContain('FAILED: At least one gapId is required');
  });

  it('should handle numeric gap IDs by normalizing them', async () => {
    mocks.getDistilledMemory.mockResolvedValue('fix bug');

    const result = await triggerBatchEvolution.execute({
      gapIds: ['123456789'],
    });

    expect(result).toContain('GAP#123456789: dispatched to Coder');
  });

  it('should handle per-gap errors without stopping', async () => {
    mocks.getDistilledMemory
      .mockResolvedValueOnce('plan1')
      .mockRejectedValueOnce(new Error('DynamoDB error'));

    const result = await triggerBatchEvolution.execute({
      gapIds: ['GAP#1', 'GAP#2'],
    });

    expect(result).toContain('GAP#1: dispatched to Coder');
    expect(result).toContain('GAP#2: ERROR');
    expect(result).toContain('DynamoDB error');
  });

  it('should handle overall failure gracefully', async () => {
    const { DynamoMemory } = await import('../../lib/memory');
    vi.mocked(DynamoMemory).mockImplementationOnce(function () {
      throw new Error('Constructor failure');
    });

    const result = await triggerBatchEvolution.execute({
      gapIds: ['GAP#1'],
    });

    expect(result).toContain('Failed to trigger batch evolution');
  });

  it('should preserve full gapId when it already contains prefix', async () => {
    mocks.getDistilledMemory.mockResolvedValue('plan');

    await triggerBatchEvolution.execute({
      gapIds: ['GAP#42'],
    });

    expect(mocks.getDistilledMemory).toHaveBeenCalledWith('PLAN#42');
  });
});

describe('requestConsensus Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fail when no voterIds provided', async () => {
    const result = await requestConsensus.execute({
      proposal: 'deploy v2',
      voterIds: [],
    });

    expect(result).toContain('FAILED: At least one voterId is required');
  });

  it('should emit consensus request event', async () => {
    const result = await requestConsensus.execute({
      proposal: 'deploy v2',
      voterIds: ['agent1', 'agent2'],
    });

    expect(result).toContain('CONSENSUS_REQUESTED');
    expect(mockEmitTypedEvent).toHaveBeenCalledWith(
      'tool.consensus',
      'consensus_request',
      expect.objectContaining({
        proposal: 'deploy v2',
        voterIds: ['agent1', 'agent2'],
        mode: 'majority',
      })
    );
  });

  it('should use provided mode and timeout', async () => {
    await requestConsensus.execute({
      proposal: 'deploy',
      voterIds: ['v1'],
      mode: 'unanimous',
      timeoutMs: 30000,
    });

    expect(mockEmitTypedEvent).toHaveBeenCalledWith(
      'tool.consensus',
      'consensus_request',
      expect.objectContaining({
        mode: 'unanimous',
        timeoutMs: 30000,
      })
    );
  });

  it('should truncate proposal in response', async () => {
    const longProposal = 'a'.repeat(200);
    const result = await requestConsensus.execute({
      proposal: longProposal,
      voterIds: ['v1'],
    });

    expect(result).toContain('...');
  });

  it('should handle emit failure gracefully', async () => {
    mockEmitTypedEvent.mockRejectedValueOnce(new Error('Bus error'));

    const result = await requestConsensus.execute({
      proposal: 'test',
      voterIds: ['v1'],
    });

    expect(result).toContain('Failed to request consensus');
  });

  it('should default mode to majority', async () => {
    await requestConsensus.execute({
      proposal: 'test',
      voterIds: ['v1'],
    });

    expect(mockEmitTypedEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ mode: 'majority' })
    );
  });

  it('should default timeoutMs to 60000', async () => {
    await requestConsensus.execute({
      proposal: 'test',
      voterIds: ['v1'],
    });

    expect(mockEmitTypedEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ timeoutMs: 60000 })
    );
  });
});

describe('voteOnProposal Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should emit vote event successfully', async () => {
    const result = await voteOnProposal.execute({
      proposalId: 'prop-1',
      vote: 'approve',
      reason: 'Looks good',
    });

    expect(result).toContain('VOTE_SUBMITTED');
    expect(result).toContain('approve');
    expect(result).toContain('prop-1');
    expect(result).toContain('Looks good');
  });

  it('should emit CONSENSUS_VOTE event', async () => {
    await voteOnProposal.execute({
      proposalId: 'prop-1',
      vote: 'reject',
      reason: 'Bad idea',
    });

    expect(mockEmitTypedEvent).toHaveBeenCalledWith(
      'tool.vote',
      'consensus_vote',
      expect.objectContaining({
        proposalId: 'prop-1',
        vote: 'reject',
        reason: 'Bad idea',
      })
    );
  });

  it('should handle emit failure gracefully', async () => {
    mockEmitTypedEvent.mockRejectedValueOnce(new Error('Bus error'));

    const result = await voteOnProposal.execute({
      proposalId: 'prop-1',
      vote: 'approve',
      reason: 'yes',
    });

    expect(result).toContain('Failed to submit vote');
  });

  it('should support abstain vote', async () => {
    const result = await voteOnProposal.execute({
      proposalId: 'prop-1',
      vote: 'abstain',
      reason: 'No opinion',
    });

    expect(result).toContain('abstain');
  });
});
