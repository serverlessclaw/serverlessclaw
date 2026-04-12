const safetyEngineMocks = vi.hoisted(() => ({
  recordSuccess: vi.fn().mockResolvedValue(90),
  recordFailure: vi.fn().mockResolvedValue(80),
}));

vi.mock('../lib/safety/safety-engine', () => ({
  SafetyEngine: class {
    recordSuccess = safetyEngineMocks.recordSuccess;
    recordFailure = safetyEngineMocks.recordFailure;
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './qa';
import { GapStatus, EvolutionMode } from '../lib/types/index';

vi.mock('./prompts/index', () => ({
  QA_SYSTEM_PROMPT: `QA System Prompt Content
  UNVERIFIED
  Mandatory Mechanical Verification
  You MUST call at least TWO verification tools before forming any verdict:
  1. 'validateCode'
  2. 'read_file'
  3. 'checkHealth'
  4. 'runTests'`,
}));

vi.mock('../lib/utils/agent-helpers', () => ({
  extractPayload: vi.fn((event: any) => event.detail || event),
  extractBaseUserId: vi.fn((userId: string) => userId.replace('CONV#', '').split('#')[0]),
  detectFailure: vi.fn((text: string) => text.includes('FAILED') || text.includes('ERROR')),
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

vi.mock('../lib/registry/index', () => ({
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
  processEventWithAgent: vi.fn().mockImplementation((...args) => {
    const lastArg = args[3] as { handlerTitle?: string };
    const responseText =
      lastArg?.handlerTitle === 'QA Auditor'
        ? 'QA verification satisfied. All checks pass.'
        : 'QA verification satisfied. All checks pass.';

    return Promise.resolve({
      responseText,
      attachments: [],
      parsedData: {
        status: responseText.toLowerCase().includes('failed') ? 'REOPEN' : 'SUCCESS',
        message: responseText,
        satisfied: !responseText.toLowerCase().includes('failed'),
      },
    });
  }),
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
    initiatorId: 'coder',
  },
};

describe('QA Agent — REOPEN cap and HITL escalation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safetyEngineMocks.recordSuccess.mockClear();
    safetyEngineMocks.recordFailure.mockClear();
    memoryMocks.updateGapStatus.mockResolvedValue({ success: true });
    memoryMocks.incrementGapAttemptCount.mockResolvedValue(1);
    memoryMocks.acquireGapLock.mockResolvedValue(true);
    memoryMocks.releaseGapLock.mockResolvedValue(true);
    registryMocks.getRawConfig.mockResolvedValue(EvolutionMode.AUTO);
  });

  describe('Trust Score Feedback Loop', () => {
    it('calls recordSuccess on satisfied verification', async () => {
      const { processEventWithAgent } = await import('../handlers/events/shared');
      (processEventWithAgent as any).mockResolvedValueOnce({
        responseText: 'QA verification satisfied. All checks pass.',
        attachments: [],
        parsedData: {
          status: 'SUCCESS',
          satisfied: true,
          score: 10,
          reasoning: 'Verified successfully',
          issues: [],
        },
      });

      await handler(BASE_PAYLOAD as any, {} as any);

      expect(safetyEngineMocks.recordSuccess).toHaveBeenCalledWith('coder', 10);
    });

    it('calls recordFailure on unsatisfied verification', async () => {
      const { processEventWithAgent } = await import('../handlers/events/shared');
      (processEventWithAgent as any).mockResolvedValueOnce({
        responseText: 'FAILED: Missing implementation',
        attachments: [],
        parsedData: {
          status: 'FAILED',
          satisfied: false,
          score: 4,
          reasoning: 'Missing implementation',
          issues: ['file.ts is empty'],
        },
      });

      await handler(BASE_PAYLOAD as any, {} as any);

      expect(safetyEngineMocks.recordFailure).toHaveBeenCalledWith(
        'coder',
        expect.stringContaining('Missing implementation')
      );
    });
  });

  it('should set gaps to DONE and not escalate on SUCCESS (auto mode)', async () => {
    const { processEventWithAgent } = await import('../handlers/events/shared');
    vi.mocked(processEventWithAgent).mockResolvedValueOnce({
      responseText: 'QA verification satisfied.',
      attachments: [],
      parsedData: {
        status: 'SUCCESS',
        satisfied: true,
        score: 10,
        reasoning: 'implementation is correct.',
        issues: [],
        suggestions: [],
      },
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
    const { processEventWithAgent } = await import('../handlers/events/shared');
    vi.mocked(processEventWithAgent).mockResolvedValueOnce({
      responseText: 'REOPEN',
      attachments: [],
      parsedData: {
        status: 'REOPEN',
        auditReport: 'the file was not changed.',
      },
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
    const { processEventWithAgent } = await import('../handlers/events/shared');
    vi.mocked(processEventWithAgent).mockResolvedValueOnce({
      responseText: 'FAILED: still broken.',
      attachments: [],
      parsedData: {
        status: 'FAILED',
        satisfied: false,
        score: 5,
        reasoning: 'still broken.',
        issues: ['still broken.'],
        suggestions: [],
      },
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

  it('audit prompt should accurately include gap ids and implementation response', async () => {
    let capturedPrompt = '';
    const { processEventWithAgent } = await import('../handlers/events/shared');
    vi.mocked(processEventWithAgent).mockImplementationOnce(
      (userId: string, agentId: string, task: string) => {
        capturedPrompt = task;
        return Promise.resolve({
          responseText: 'QA verification satisfied.',
          attachments: [],
          parsedData: {
            status: 'SUCCESS',
            satisfied: true,
            reasoning: 'verified',
            issues: [],
            suggestions: [],
            score: 10,
          },
        });
      }
    );
    registryMocks.getRawConfig.mockResolvedValue(EvolutionMode.AUTO);

    await handler(
      BASE_PAYLOAD as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    // Prompt must instruct QA on the gaps and provide the implementation
    expect(capturedPrompt).toMatch(/Verify and audit the following gaps: GAP#1001/i);
    expect(capturedPrompt).toMatch(/Coder reported success/i);
  });

  it('should skip verification if payload is incomplete', async () => {
    const incompletePayload = { detail: { userId: 'u1' } }; // missing gapIds
    await handler(incompletePayload as any, {} as any);
    expect(agentProcess).not.toHaveBeenCalled();
  });

  it('should handle JSON parse failure and fallback to REOPEN', async () => {
    const { processEventWithAgent } = await import('../handlers/events/shared');
    (processEventWithAgent as any).mockResolvedValueOnce({
      responseText: 'Not a JSON string', // This will be treated as failure by detectFailure
      attachments: [],
    });

    await handler(BASE_PAYLOAD as any, {} as any);

    expect(memoryMocks.updateGapStatus).toHaveBeenCalledWith('GAP#1001', GapStatus.OPEN);
  });

  it('should handle lock acquisition failure during SUCCESS path', async () => {
    const { processEventWithAgent } = await import('../handlers/events/shared');
    (processEventWithAgent as any).mockResolvedValueOnce({
      responseText: 'QA verification satisfied. All checks pass.',
      attachments: [],
    });
    memoryMocks.acquireGapLock.mockResolvedValueOnce(false);

    await handler(BASE_PAYLOAD as any, {} as any);

    expect(memoryMocks.updateGapStatus).not.toHaveBeenCalledWith('GAP#1001', GapStatus.DONE);
  });

  it('should handle gap status update failure', async () => {
    const { processEventWithAgent } = await import('../handlers/events/shared');
    (processEventWithAgent as any).mockResolvedValueOnce({
      responseText: 'QA verification satisfied. All checks pass.',
      attachments: [],
    });
    memoryMocks.updateGapStatus.mockResolvedValueOnce({ success: false, error: 'DB Error' });

    await handler(BASE_PAYLOAD as any, {} as any);

    expect(memoryMocks.updateGapStatus).toHaveBeenCalled();
  });

  it('should not auto-close gaps in HITL mode', async () => {
    const { processEventWithAgent } = await import('../handlers/events/shared');
    (processEventWithAgent as any).mockResolvedValueOnce({
      responseText: 'QA verification satisfied. All checks pass.',
      attachments: [],
    });
    registryMocks.getRawConfig.mockResolvedValue(EvolutionMode.HITL);

    await handler(BASE_PAYLOAD as any, {} as any);

    expect(memoryMocks.updateGapStatus).not.toHaveBeenCalledWith('GAP#1001', GapStatus.DONE);
  });

  it('should dispatch task to initiator if initiatorId is present on failure', async () => {
    const { processEventWithAgent } = await import('../handlers/events/shared');
    (processEventWithAgent as any).mockResolvedValueOnce({
      responseText: 'QA verification FAILED: Some checks did not pass.',
      attachments: [],
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
    const { processEventWithAgent } = await import('../handlers/events/shared');
    (processEventWithAgent as any).mockResolvedValueOnce({
      responseText: 'QA verification FAILED: Some checks did not pass.',
      attachments: [],
    });

    const payloadNoInitiator = {
      ...BASE_PAYLOAD,
      detail: { ...BASE_PAYLOAD.detail, initiatorId: undefined },
    };

    await handler(payloadNoInitiator as any, {} as any);

    const { wakeupInitiator } = await import('../handlers/events/shared');
    expect(wakeupInitiator).not.toHaveBeenCalled();
  });
});
