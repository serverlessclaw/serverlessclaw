import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './strategic-planner';
import { GapStatus } from '../lib/types/index';

const memoryMocks = vi.hoisted(() => ({
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  getAllGaps: vi.fn(),
  getDistilledMemory: vi.fn(),
  updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
}));

const agentProcess = vi.hoisted(() => vi.fn());

const registryMocks = vi.hoisted(() => ({
  getAgentConfig: vi.fn(),
  getRawConfig: vi.fn(),
  saveRawConfig: vi.fn().mockResolvedValue(undefined),
  recordToolUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    updateGapStatus = memoryMocks.updateGapStatus;
    getAllGaps = memoryMocks.getAllGaps;
    getDistilledMemory = memoryMocks.getDistilledMemory;
    updateDistilledMemory = memoryMocks.updateDistilledMemory;
    archiveStaleGaps = vi.fn().mockResolvedValue(0);
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
  tools: { dispatchTask: { execute: vi.fn().mockResolvedValue(undefined) } },
}));

vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn().mockResolvedValue({}) })) },
  GetCommand: class {
    constructor(public input: unknown) {}
  },
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
    ConfigTable: { name: 'test-config' },
  },
}));

const OPEN_GAP_A = {
  id: 'GAP#1001',
  content: 'the system cannot search Slack messages',
  timestamp: 1001,
  metadata: { impact: 8, urgency: 5, risk: 3, priority: 8, confidence: 7, complexity: 4 },
};
const OPEN_GAP_B = {
  id: 'GAP#1002',
  content: 'the system has no image recognition capability',
  timestamp: 1002,
  metadata: { impact: 6, urgency: 3, risk: 2, priority: 6, confidence: 7, complexity: 5 },
};

describe('Strategic Planner — selective PLANNED marking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No cooldown by default
    memoryMocks.getDistilledMemory.mockResolvedValue(null);
    // Default: solo gap mode, not scheduled review
    memoryMocks.getAllGaps.mockResolvedValue([OPEN_GAP_A, OPEN_GAP_B]);
    // Allow scheduled review to pass frequency + min-gap checks with the 2 test gaps
    registryMocks.getRawConfig.mockImplementation((key: string) => {
      if (key === 'min_gaps_for_review') return Promise.resolve(1);
      if (key === 'strategic_review_frequency') return Promise.resolve(1); // 1h
      return Promise.resolve(undefined);
    });
    registryMocks.getAgentConfig.mockResolvedValue({
      id: 'planner',
      name: 'Planner',
      systemPrompt: 'Planner prompt',
      enabled: true,
    });
  });

  it('should only mark gaps PLANNED whose content appears in the plan text (scheduled review)', async () => {
    // Plan references ONLY gap A content
    const planText = `STRATEGIC_PLAN: Add Slack search integration. The system cannot search Slack messages so we will implement a new tool.`;
    agentProcess.mockResolvedValue(planText);

    // Simulate scheduled review passing minimum requirements
    // (frequency and min-gap checks are bypassed by mocking)
    const event = {
      detail: {
        contextUserId: 'user-1',
        isScheduledReview: true,
        traceId: 'trace-1',
      },
    };

    await handler(event as any, {} as any);

    // Gap A content excerpt appears in plan → PLANNED
    const plannedCalls = memoryMocks.updateGapStatus.mock.calls.filter(
      (c: unknown[]) => c[1] === GapStatus.PLANNED
    );
    const openCalls = memoryMocks.updateGapStatus.mock.calls.filter(
      (c: unknown[]) => c[1] === GapStatus.OPEN
    );

    // Only covered gap should be PLANNED, not all gaps
    expect(plannedCalls.length).toBeGreaterThan(0);
    // Gap B content ('image recognition') is NOT in the plan — it must NOT be PLANNED
    const gapBPlanned = plannedCalls.some((c: unknown[]) => String(c[0]).includes('1002'));
    expect(gapBPlanned).toBe(false);
    // Gap B stays OPEN
    expect(openCalls.length).toBe(0); // updateGapStatus for OPEN not called directly by planner
  });

  it('should return COOLDOWN_ACTIVE if the same gapId was planned recently', async () => {
    const cooldownStore = JSON.stringify([
      { gapId: 'GAP#5001', expiresAt: Date.now() + 3_600_000 }, // still active
    ]);
    memoryMocks.getDistilledMemory.mockResolvedValue(cooldownStore);

    const event = {
      detail: {
        gapId: 'GAP#5001',
        details: 'some gap',
        contextUserId: 'user-1',
      },
    };

    const result = await handler(event as any);
    expect(result).toMatchObject({ status: 'COOLDOWN_ACTIVE' });
    expect(agentProcess).not.toHaveBeenCalled();
  });

  it('should proceed if cooldown entry is expired', async () => {
    const cooldownStore = JSON.stringify([
      { gapId: 'GAP#5002', expiresAt: Date.now() - 1000 }, // expired
    ]);
    memoryMocks.getDistilledMemory.mockResolvedValue(cooldownStore);
    agentProcess.mockResolvedValue('STRATEGIC_PLAN: fix things');

    const event = {
      detail: {
        gapId: 'GAP#5002',
        details: 'some gap description',
        contextUserId: 'user-1',
      },
    };

    const result = await handler(event as any);
    expect(result).not.toMatchObject({ status: 'COOLDOWN_ACTIVE' });
    expect(agentProcess).toHaveBeenCalled();
  });

  it('should NOT check cooldown for scheduled reviews (gapId is undefined)', async () => {
    // Even if there are cooldown entries, scheduled review should not be blocked
    const cooldownStore = JSON.stringify([
      { gapId: 'GAP#9999', expiresAt: Date.now() + 3_600_000 },
    ]);
    memoryMocks.getDistilledMemory.mockResolvedValue(cooldownStore);
    agentProcess.mockResolvedValue('STRATEGIC_PLAN: review result');

    const event = {
      detail: {
        contextUserId: 'user-1',
        isScheduledReview: true,
      },
    };

    const result = await handler(event as any);
    // Should not return COOLDOWN_ACTIVE (that would block all scheduled reviews)
    expect(result).not.toMatchObject({ status: 'COOLDOWN_ACTIVE' });
  });
});
