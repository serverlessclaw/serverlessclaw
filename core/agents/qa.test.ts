import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './qa';
import { GapStatus, EvolutionMode } from '../lib/types/index';

vi.mock('../lib/utils/agent-helpers', () => ({
  extractPayload: vi.fn((event: any) => event.detail || event),
  loadAgentConfig: vi.fn().mockResolvedValue({
    id: 'qa',
    name: 'QA',
    systemPrompt: 'QA prompt',
    enabled: true,
  }),
  getAgentContext: vi.fn().mockResolvedValue({
    memory: {
      updateGapStatus: memoryMocks.updateGapStatus,
      incrementGapAttemptCount: memoryMocks.incrementGapAttemptCount,
    },
    provider: {
      call: vi.fn(),
    },
  }),
  emitTaskEvent: vi.fn().mockResolvedValue(undefined),
}));

const memoryMocks = vi.hoisted(() => ({
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  incrementGapAttemptCount: vi.fn(),
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
  },
}));

vi.mock('../lib/registry', () => ({
  AgentRegistry: registryMocks,
}));

vi.mock('../lib/agent', () => ({
  Agent: class {
    process = agentProcess;
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
    registryMocks.getRawConfig.mockResolvedValue(EvolutionMode.AUTO);
  });

  it('should set gaps to DONE and not escalate on SUCCESS (auto mode)', async () => {
    agentProcess.mockResolvedValue({
      responseText: JSON.stringify({
        status: 'SUCCESS',
        auditReport: 'implementation is correct.',
      }),
    });
    registryMocks.getRawConfig.mockResolvedValue('auto');

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
    expect(registryMocks.saveRawConfig).not.toHaveBeenCalledWith('evolution_mode', 'hitl');
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
    expect(registryMocks.saveRawConfig).not.toHaveBeenCalledWith('evolution_mode', 'hitl');
  });

  it('audit prompt should mandate independent tool verification, not trust coder testimony', async () => {
    let capturedPrompt = '';
    agentProcess.mockImplementation((userId: string, prompt: string) => {
      capturedPrompt = prompt;
      return Promise.resolve({ responseText: 'VERIFICATION_SUCCESSFUL' });
    });
    registryMocks.getRawConfig.mockResolvedValue('auto');

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
});
