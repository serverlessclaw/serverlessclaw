import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './critic';
import type { CriticVerdict, ReviewMode } from './critic/schema';

// ============================================================================
// Mock Setup
// ============================================================================

const emitTaskEventMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const memoryMocks = vi.hoisted(() => ({
  getSummary: vi.fn().mockResolvedValue(null),
  updateSummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/utils/agent-helpers', () => ({
  extractPayload: vi.fn((event: any) => event.detail || event),
  extractBaseUserId: vi.fn((userId: string) => userId.replace('CONV#', '').split('#')[0]),
  validatePayload: vi.fn(() => true),
  buildProcessOptions: vi.fn((opts: any) => opts),
  initAgent: vi.fn().mockResolvedValue({
    config: { id: 'critic', name: 'Critic Agent', enabled: true },
    memory: memoryMocks,
    agent: { process: agentProcess },
  }),
  getAgentContext: vi.fn().mockResolvedValue({
    memory: memoryMocks,
  }),
  isTaskPaused: vi.fn(() => false),
  detectFailure: vi.fn(() => false),
}));

vi.mock('../lib/utils/agent-helpers/event-emitter', () => ({
  emitTaskEvent: emitTaskEventMock,
}));

const agentProcess = vi.hoisted(() => vi.fn());

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    getSummary = memoryMocks.getSummary;
    updateSummary = memoryMocks.updateSummary;
  },
}));

vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      id: 'critic',
      name: 'Critic Agent',
      enabled: true,
    }),
    getRawConfig: vi.fn().mockResolvedValue(undefined),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../lib/agent', () => ({
  Agent: class {
    process = agentProcess;
    stream = async function* (this: any, ...args: any[]) {
      const result = await agentProcess.apply(this, args);
      yield { content: result.responseText };
    };
  },
}));

vi.mock('../lib/providers/index', () => ({
  ProviderManager: class {},
}));

vi.mock('../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
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

// ============================================================================
// Test Helpers
// ============================================================================

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    detail: {
      userId: 'user-1',
      task: 'Review the strategic plan for adding Slack integration',
      metadata: {
        reviewMode: 'security' as ReviewMode,
        planId: 'PLAN-001',
        gapIds: ['GAP#1001'],
      },
      traceId: 'trace-1',
      sessionId: 'session-1',
      ...overrides,
    },
  };
}

function createApprovedVerdict(mode: ReviewMode = 'security'): CriticVerdict {
  return {
    verdict: 'APPROVED',
    reviewMode: mode,
    confidence: 8,
    findings: [],
    summary: 'No issues found. Plan is safe to proceed.',
  };
}

function createRejectedVerdict(
  mode: ReviewMode = 'security',
  reason = 'SQL injection risk'
): CriticVerdict {
  return {
    verdict: 'REJECTED',
    reviewMode: mode,
    confidence: 9,
    findings: [
      {
        severity: 'critical',
        category: 'injection',
        description: reason,
        location: 'core/handlers/webhook.ts:42',
        suggestion: 'Use parameterized queries',
      },
    ],
    summary: `Critical finding: ${reason}`,
  };
}

function createConditionalVerdict(mode: ReviewMode = 'performance'): CriticVerdict {
  return {
    verdict: 'CONDITIONAL',
    reviewMode: mode,
    confidence: 7,
    findings: [
      {
        severity: 'high',
        category: 'latency',
        description: 'Missing pagination on query',
        location: 'core/lib/memory.ts:120',
        suggestion: 'Add limit parameter to query',
      },
    ],
    summary: 'High severity finding that can be mitigated with fixes.',
  };
}

// ============================================================================
// Tests: Verdict Parsing
// ============================================================================

describe('Critic Agent — Verdict Parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse APPROVED verdict from JSON response', async () => {
    const verdict = createApprovedVerdict();
    agentProcess.mockResolvedValue({
      responseText: JSON.stringify(verdict),
      attachments: [],
    });

    const result = await handler(
      createPayload() as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    const parsed = JSON.parse(result!);
    expect(parsed.verdict).toBe('APPROVED');
    expect(parsed.reviewMode).toBe('security');
    expect(parsed.confidence).toBe(8);
    expect(parsed.findings).toHaveLength(0);
  });

  it('should parse REJECTED verdict from JSON response', async () => {
    const verdict = createRejectedVerdict();
    agentProcess.mockResolvedValue({
      responseText: JSON.stringify(verdict),
      attachments: [],
    });

    const result = await handler(
      createPayload() as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    const parsed = JSON.parse(result!);
    expect(parsed.verdict).toBe('REJECTED');
    expect(parsed.findings[0].severity).toBe('critical');
  });

  it('should parse CONDITIONAL verdict from JSON response', async () => {
    const verdict = createConditionalVerdict();
    agentProcess.mockResolvedValue({
      responseText: JSON.stringify(verdict),
      attachments: [],
    });

    const result = await handler(
      createPayload({
        metadata: { reviewMode: 'performance', planId: 'PLAN-001', gapIds: ['GAP#1001'] },
      }) as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    const parsed = JSON.parse(result!);
    expect(parsed.verdict).toBe('CONDITIONAL');
    expect(parsed.findings[0].severity).toBe('high');
  });

  it('should default to REJECTED on parse failure', async () => {
    agentProcess.mockResolvedValue({
      responseText: 'This is not valid JSON',
      attachments: [],
    });

    const result = await handler(
      createPayload() as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    const parsed = JSON.parse(result!);
    expect(parsed.verdict).toBe('REJECTED');
    expect(parsed.findings[0].category).toBe('parse_error');
  });
});

// ============================================================================
// Tests: Review Modes
// ============================================================================

describe('Critic Agent — Review Modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use security review mode when specified', async () => {
    let capturedPrompt = '';
    agentProcess.mockImplementation((_userId: string, prompt: string) => {
      capturedPrompt = prompt;
      return Promise.resolve({
        responseText: JSON.stringify(createApprovedVerdict('security')),
        attachments: [],
      });
    });

    await handler(
      createPayload({
        metadata: { reviewMode: 'security', planId: 'PLAN-001', gapIds: ['GAP#1001'] },
      }) as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    expect(capturedPrompt).toContain('SECURITY review');
    expect(capturedPrompt).toContain('Injection vulnerabilities');
    expect(capturedPrompt).toContain('Authentication/authorization bypass');
  });

  it('should use performance review mode when specified', async () => {
    let capturedPrompt = '';
    agentProcess.mockImplementation((_userId: string, prompt: string) => {
      capturedPrompt = prompt;
      return Promise.resolve({
        responseText: JSON.stringify(createApprovedVerdict('performance')),
        attachments: [],
      });
    });

    await handler(
      createPayload({
        metadata: { reviewMode: 'performance', planId: 'PLAN-001', gapIds: ['GAP#1001'] },
      }) as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    expect(capturedPrompt).toContain('PERFORMANCE review');
    expect(capturedPrompt).toContain('Lambda cold start impact');
    expect(capturedPrompt).toContain('Memory usage and timeout risks');
  });

  it('should use architect review mode when specified', async () => {
    let capturedPrompt = '';
    agentProcess.mockImplementation((_userId: string, prompt: string) => {
      capturedPrompt = prompt;
      return Promise.resolve({
        responseText: JSON.stringify(createApprovedVerdict('architect')),
        attachments: [],
      });
    });

    await handler(
      createPayload({
        metadata: { reviewMode: 'architect', planId: 'PLAN-001', gapIds: ['GAP#1001'] },
      }) as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    expect(capturedPrompt).toContain('ARCHITECTURAL review');
    expect(capturedPrompt).toContain('Design coherence');
    expect(capturedPrompt).toContain('Blast radius of changes');
  });

  it('should default to architect mode when reviewMode is not specified', async () => {
    let capturedPrompt = '';
    agentProcess.mockImplementation((_userId: string, prompt: string) => {
      capturedPrompt = prompt;
      return Promise.resolve({
        responseText: JSON.stringify(createApprovedVerdict('architect')),
        attachments: [],
      });
    });

    await handler(
      createPayload({
        metadata: { planId: 'PLAN-001', gapIds: ['GAP#1001'] },
      }) as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    expect(capturedPrompt).toContain('ARCHITECTURAL review');
  });
});

// ============================================================================
// Tests: Critical Findings Alert
// ============================================================================

describe('Critic Agent — Critical Findings Alert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send outbound message when critical findings are detected', async () => {
    const { sendOutboundMessage } = await import('../lib/outbound');

    agentProcess.mockResolvedValue({
      responseText: JSON.stringify(createRejectedVerdict('security')),
      attachments: [],
    });

    await handler(
      createPayload() as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    expect(sendOutboundMessage).toHaveBeenCalledWith(
      'critic.agent',
      'user-1',
      expect.stringContaining('Critical Review Finding'),
      ['user-1'],
      'session-1',
      'Critic Agent'
    );
  });

  it('should not send outbound message when no critical findings', async () => {
    const { sendOutboundMessage } = await import('../lib/outbound');

    agentProcess.mockResolvedValue({
      responseText: JSON.stringify(createApprovedVerdict()),
      attachments: [],
    });

    await handler(
      createPayload() as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    expect(sendOutboundMessage).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: Emit Task Event
// ============================================================================

describe('Critic Agent — Task Event Emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should emit TASK_COMPLETED event with verdict', async () => {
    agentProcess.mockResolvedValue({
      responseText: JSON.stringify(createApprovedVerdict()),
      attachments: [],
    });

    await handler(
      createPayload() as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    expect(emitTaskEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'critic.agent',
        agentId: 'critic',
        userId: 'user-1',
        task: 'Review plan PLAN-001 (security)',
        traceId: 'trace-1',
        sessionId: 'session-1',
      })
    );
  });
});

// ============================================================================
// Tests: Verdict Schema Validation
// ============================================================================

describe('Critic Agent — Schema', () => {
  it('should have correct schema structure', async () => {
    const { CriticVerdictSchema } = await import('./critic/schema');

    expect(CriticVerdictSchema.type).toBe('object');
    expect(CriticVerdictSchema.properties.verdict.enum).toEqual([
      'APPROVED',
      'REJECTED',
      'CONDITIONAL',
    ]);
    expect(CriticVerdictSchema.properties.reviewMode.enum).toEqual([
      'security',
      'performance',
      'architect',
    ]);
    expect(CriticVerdictSchema.properties.confidence.minimum).toBe(1);
    expect(CriticVerdictSchema.properties.confidence.maximum).toBe(10);
    expect(CriticVerdictSchema.required).toContain('verdict');
    expect(CriticVerdictSchema.required).toContain('reviewMode');
    expect(CriticVerdictSchema.required).toContain('confidence');
    expect(CriticVerdictSchema.required).toContain('findings');
    expect(CriticVerdictSchema.required).toContain('summary');
  });
});
