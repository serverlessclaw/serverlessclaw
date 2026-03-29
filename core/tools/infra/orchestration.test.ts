import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signalOrchestration, triggerBatchEvolution } from './orchestration';
import { AgentStatus, AgentType } from '../../lib/types/agent';
import { logger } from '../../lib/logger';

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
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

describe('signalOrchestration Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully emit a SUCCESS signal', async () => {
    const args = {
      status: AgentStatus.SUCCESS,
      reasoning: 'The task was completed according to requirements.',
      nextStep: 'Notify the user of completion.',
      targetAgentId: AgentType.SUPERCLAW,
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
      targetAgentId: AgentType.STRATEGIC_PLANNER,
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
      targetAgentId: AgentType.SUPERCLAW,
    };

    const result = await signalOrchestration.execute(args);

    expect(result).toContain('ORCHESTRATION_SIGNAL_EMITTED: ESCALATE');
    expect(result).toContain('Next Step: Ask the user for manual approval');
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
});
