import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './qa';
import { GapStatus, EvolutionMode } from '../lib/types/index';

vi.mock('../lib/utils/agent-helpers', () => ({
  extractPayload: vi.fn((event: any) => event.detail || event),
  extractBaseUserId: vi.fn((userId: string) => userId.replace('CONV#', '').split('#')[0]),
  initAgent: vi.fn().mockResolvedValue({
    config: {
      id: 'qa',
      name: 'QA',
      systemPrompt: 'QA prompt',
      enabled: true,
    },
    memory: {
      updateGapStatus: memoryMocks.updateGapStatus,
      incrementGapAttemptCount: memoryMocks.incrementGapAttemptCount,
      acquireGapLock: memoryMocks.acquireGapLock,
      releaseGapLock: memoryMocks.releaseGapLock,
      recordFailedPlan: memoryMocks.recordFailedPlan,
    },
    provider: {
      call: vi.fn(),
    },
    agent: {
      process: agentProcess,
    },
  }),
  emitTaskEvent: vi.fn().mockResolvedValue(undefined),
}));

const memoryMocks = vi.hoisted(() => ({
  updateGapStatus: vi.fn().mockResolvedValue({ success: true }),
  incrementGapAttemptCount: vi.fn().mockResolvedValue(1),
  acquireGapLock: vi.fn().mockResolvedValue(true),
  releaseGapLock: vi.fn().mockResolvedValue(true),
  recordFailedPlan: vi.fn().mockResolvedValue(undefined),
}));

const registryMocks = vi.hoisted(() => ({
  getAgentConfig: vi.fn().mockResolvedValue({
    id: 'qa',
    name: 'QA',
    systemPrompt: 'QA prompt',
    enabled: true,
  }),
  getRawConfig: vi.fn(),
  saveRawConfig: vi.fn().mockResolvedValue(undefined),
}));

const agentProcess = vi.hoisted(() => vi.fn());

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    updateGapStatus = memoryMocks.updateGapStatus;
    incrementGapAttemptCount = memoryMocks.incrementGapAttemptCount;
    getSummary = vi.fn().mockResolvedValue(null);
    updateSummary = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../lib/registry', () => ({
  AgentRegistry: registryMocks,
}));

vi.mock('../lib/agent', () => ({
  Agent: class {
    process = agentProcess;
    stream = async function* (this: any) {
      // eslint-disable-next-line prefer-rest-params
      const result = await agentProcess.apply(this, arguments as any);
      yield { content: result.responseText };
    };
  },
}));

vi.mock('../lib/providers/index', () => ({
  ProviderManager: class {},
}));

vi.mock('../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
  TOOLS: {
    dispatchTask: {
      execute: vi.fn().mockResolvedValue(undefined),
    },
  },
  tools: {
    dispatchTask: {
      execute: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../handlers/events/shared', () => ({
  wakeupInitiator: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: class {
    send = vi.fn().mockResolvedValue({});
  },
  PutEventsCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
    MemoryTable: { name: 'test-memory' },
  },
}));

const BASE_PAYLOAD = {
  detail: {
    userId: 'user-1',
    metadata: { gapIds: ['GAP#1001'] },
    response: 'Coder reported success.',
    traceId: 'trace-1',
  },
};

describe('QA Agent — REOPEN cap and HITL escalation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryMocks.updateGapStatus.mockResolvedValue({ success: true });
    memoryMocks.incrementGapAttemptCount.mockResolvedValue(1);
    memoryMocks.acquireGapLock.mockResolvedValue(true);
    memoryMocks.releaseGapLock.mockResolvedValue(true);
    registryMocks.getRawConfig.mockResolvedValue(EvolutionMode.AUTO);
  });

  it('should set gaps to DONE and not escalate on SUCCESS (auto mode)', async () => {
    agentProcess.mockResolvedValue({
      responseText: JSON.stringify({
        status: 'SUCCESS',
        auditReport: 'implementation is correct.',
      }),
    });
    registryMocks.getRawConfig.mockResolvedValue(EvolutionMode.AUTO);

    await handler(
      BASE_PAYLOAD as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#1001', GapStatus.DONE);
    expect(memoryMocks.incrementGapAttemptCount).not.toHaveBeenCalled();
    expect(registryMocks.saveRawConfig).not.toHaveBeenCalled();
  });

  it('should REOPEN gap and increment attempt count on REOPEN status below cap', async () => {
    agentProcess.mockResolvedValue({
      responseText: JSON.stringify({
        status: 'REOPEN',
        auditReport: 'the file was not changed.',
      }),
    });
    memoryMocks.incrementGapAttemptCount.mockResolvedValue(1); // attempt 1 of 3

    await handler(
      BASE_PAYLOAD as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    expect(memoryMocks.incrementGapAttemptCount).toHaveBeenCalledWith('GAP#1001');
    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#1001', GapStatus.OPEN);
    // No escalation yet
    expect(registryMocks.saveRawConfig).not.toHaveBeenCalledWith(
      'evolution_mode',
      EvolutionMode.HITL
    );
  });

  it('should escalate to FAILED and send alert when reopen cap (3) is reached', async () => {
    agentProcess.mockResolvedValue({
      responseText: JSON.stringify({
        status: 'REOPEN',
        auditReport: 'still broken.',
      }),
    });
    memoryMocks.incrementGapAttemptCount.mockResolvedValue(3); // cap reached

    await handler(
      BASE_PAYLOAD as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    // Gap is escalated to FAILED
    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#1001', GapStatus.FAILED);
    // Evolution mode is NOT forced to HITL
    expect(registryMocks.saveRawConfig).not.toHaveBeenCalledWith(
      'evolution_mode',
      EvolutionMode.HITL
    );
  });

  it('audit prompt should mandate independent tool verification, not trust coder testimony', async () => {
    let capturedPrompt = '';
    agentProcess.mockImplementation((userId: string, prompt: string) => {
      capturedPrompt = prompt;
      return Promise.resolve({ responseText: 'VERIFICATION_SUCCESSFUL' });
    });
    registryMocks.getRawConfig.mockResolvedValue(EvolutionMode.AUTO);

    await handler(
      BASE_PAYLOAD as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    // Prompt must instruct QA to run mechanical checks first
    expect(capturedPrompt).toMatch(/STEP 1/i);
    expect(capturedPrompt).toMatch(/mandatory|must/i);
    expect(capturedPrompt).toMatch(/validateCode|read_file|listFiles|checkHealth/i);
    // Coder response is clearly labelled as unverified
    expect(capturedPrompt).toMatch(/unverified/i);
  });

  it('should skip verification if payload is incomplete', async () => {
    const incompletePayload = { detail: { userId: 'u1' } }; // missing gapIds
    await handler(incompletePayload as any, {} as any);
    expect(agentProcess).not.toHaveBeenCalled();
  });

  it('should handle JSON parse failure and fallback to REOPEN', async () => {
    agentProcess.mockResolvedValueOnce({
      responseText: 'Not a JSON string',
    });

    await handler(BASE_PAYLOAD as any, {} as any);

    // Default status is REOPEN
    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#1001', GapStatus.OPEN);
  });

  it('should handle lock acquisition failure during SUCCESS path', async () => {
    agentProcess.mockResolvedValueOnce({
      responseText: JSON.stringify({ status: 'SUCCESS', auditReport: 'ok' }),
    });
    memoryMocks.acquireGapLock.mockResolvedValueOnce(false);

    await handler(BASE_PAYLOAD as any, {} as any);

    expect(memoryMocks.updateGapStatus).not.toHaveBeenCalledWith('GAP#1001', GapStatus.DONE);
  });

  it('should handle gap status update failure', async () => {
    agentProcess.mockResolvedValueOnce({
      responseText: JSON.stringify({ status: 'SUCCESS', auditReport: 'ok' }),
    });
    memoryMocks.updateGapStatus.mockResolvedValueOnce({ success: false, error: 'DB Error' });

    await handler(BASE_PAYLOAD as any, {} as any);

    expect(memoryMocks.updateGapStatus).toHaveBeenCalled();
    // It should log error but not throw
  });

  it('should not auto-close gaps in HITL mode', async () => {
    agentProcess.mockResolvedValueOnce({
      responseText: JSON.stringify({ status: 'SUCCESS', auditReport: 'ok' }),
    });
    registryMocks.getRawConfig.mockResolvedValue(EvolutionMode.HITL);

    await handler(BASE_PAYLOAD as any, {} as any);

    expect(memoryMocks.updateGapStatus).not.toHaveBeenCalledWith('GAP#1001', GapStatus.DONE);
  });

  it('should dispatch task to initiator if initiatorId is present on failure', async () => {
    agentProcess.mockResolvedValueOnce({
      responseText: JSON.stringify({ status: 'REOPEN', auditReport: 'fail' }),
    });
    const payloadWithInitiator = {
      detail: { ...BASE_PAYLOAD.detail, initiatorId: 'initiator-1' },
    };

    const { wakeupInitiator } = await import('../handlers/events/shared');

    await handler(payloadWithInitiator as any, {} as any);

    expect(wakeupInitiator).toHaveBeenCalledWith(
      'user-1',
      'initiator-1',
      expect.stringContaining(
        'QA_VERIFICATION_FAILED: The changes for gaps GAP#1001 failed verification'
      ),
      'trace-1',
      undefined,
      undefined
    );
  });

  it('should fallback to dispatcher if no initiatorId is present on failure', async () => {
    agentProcess.mockResolvedValueOnce({
      responseText: JSON.stringify({ status: 'REOPEN', auditReport: 'fail' }),
    });

    const { TOOLS } = await import('../tools/index');

    await handler(BASE_PAYLOAD as any, {} as any);

    expect(TOOLS.dispatchTask.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'coder',
        task: expect.stringContaining('QA verification failed'),
      })
    );
  });
});
