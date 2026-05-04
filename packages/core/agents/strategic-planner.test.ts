import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './strategic-planner';
import { GapStatus } from '../lib/types/agent';
import { AGENT_TYPES } from '../lib/types/index';

const memoryMocks = vi.hoisted(() => ({
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  getAllGaps: vi.fn(),
  getDistilledMemory: vi.fn(),
  updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  setGap: vi.fn().mockResolvedValue(undefined),
  searchInsights: vi.fn().mockResolvedValue({ items: [], lastEvaluatedKey: null }),
  acquireGapLock: vi.fn().mockResolvedValue(true),
  getGapLock: vi.fn().mockResolvedValue(null),
  getGlobalLessons: vi.fn().mockResolvedValue([]),
  getFailurePatterns: vi.fn().mockResolvedValue([]),
  recordFailurePattern: vi.fn().mockResolvedValue(undefined),
}));

import { processEventWithAgent } from '../handlers/events/shared';

const gapOperationsMocks = vi.hoisted(() => ({
  assignGapToTrack: vi.fn().mockResolvedValue(undefined),
  determineTrack: vi.fn().mockReturnValue('FEATURE'),
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
    setGap = memoryMocks.setGap;
    searchInsights = memoryMocks.searchInsights;
    archiveStaleGaps = vi.fn().mockResolvedValue(0);
    getLowUtilizationMemory = vi.fn().mockResolvedValue([]);
    getSummary = vi.fn().mockResolvedValue(null);
    updateSummary = vi.fn().mockResolvedValue(undefined);
    acquireGapLock = memoryMocks.acquireGapLock;
    getGapLock = memoryMocks.getGapLock;
    getGlobalLessons = memoryMocks.getGlobalLessons;
    getFailurePatterns = memoryMocks.getFailurePatterns;
    recordFailurePattern = memoryMocks.recordFailurePattern;
  },
}));

vi.mock('../lib/registry/index', () => ({
  AgentRegistry: registryMocks,
}));

vi.mock('../lib/scheduler', () => ({
  DynamicScheduler: {
    getSchedule: vi.fn().mockResolvedValue(null),
    upsertSchedule: vi.fn().mockResolvedValue(undefined),
    removeSchedule: vi.fn().mockResolvedValue(undefined),
    listSchedules: vi.fn().mockResolvedValue([]),
    ensureProactiveGoal: vi.fn().mockResolvedValue(undefined),
  },
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
  getToolDefinitions: vi.fn().mockReturnValue([]),
  TOOLS: { dispatchTask: { execute: vi.fn().mockResolvedValue(undefined) } },
}));

const registryUtilsMocks = vi.hoisted(() => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../tools/registry-utils', () => registryUtilsMocks);

vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../handlers/events/shared', () => ({
  wakeupInitiator: vi.fn().mockResolvedValue(undefined),
  getRecursionLimit: vi.fn().mockResolvedValue(15),
  handleRecursionLimitExceeded: vi.fn().mockResolvedValue(undefined),
  processEventWithAgent: vi.fn().mockImplementation((_userId, _agentId, _task, options) => {
    return Promise.resolve({
      responseText:
        options.handlerTitle === 'Strategic Planner'
          ? JSON.stringify({
              status: 'SUCCESS',
              plan: 'Test Plan Content',
              coveredGapIds: ['GAP#1001'],
            })
          : 'Mock response',
      attachments: [],
      parsedData:
        options.handlerTitle === 'Strategic Planner'
          ? {
              status: 'SUCCESS',
              plan: 'Test Plan Content',
              coveredGapIds: ['GAP#1001'],
            }
          : null,
    });
  }),
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

vi.mock('../lib/memory/gap-operations', () => ({
  assignGapToTrack: gapOperationsMocks.assignGapToTrack,
  determineTrack: gapOperationsMocks.determineTrack,
}));

const OPEN_GAP_A = {
  id: 'GAP#1001',
  content: 'the system cannot search Slack messages',
  timestamp: 1001,
  status: GapStatus.OPEN,
  metadata: { impact: 8, urgency: 5, risk: 3, priority: 8, confidence: 7, complexity: 4 },
};
const OPEN_GAP_B = {
  id: 'GAP#1002',
  content: 'the system has no image recognition capability',
  timestamp: 1002,
  status: GapStatus.OPEN,
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
      id: 'strategic-planner',
      name: 'Planner',
      systemPrompt: 'Planner prompt',
      enabled: true,
    });
  });

  it('should mark gaps PLANNED based on coveredGapIds in structured output (scheduled review)', async () => {
    // Structured response explicitly covering Gap A
    const planResponse = JSON.stringify({
      status: 'SUCCESS',
      plan:
        'Add Slack search integration to enable users to query the knowledge base directly from Slack channels. ' +
        'This requires implementing a new connector that interfaces with the Slack API to allow seamless message searching. ' +
        'The connector should support filtering by channel, date range, and user. It should also support pagination for large result sets. ' +
        'Additionally, the search results should be ranked by relevance and recency. The implementation should follow the existing ' +
        'connector patterns and include proper error handling, rate limiting, and caching to ensure optimal performance. We will also ' +
        'need to update the documentation and add integration tests to verify the connector works end-to-end with the Slack API.',
      coveredGapIds: ['GAP#1001'],
      reasoning: 'Missing tools',
    });
    const { processEventWithAgent } = await import('../handlers/events/shared');
    vi.mocked(processEventWithAgent).mockResolvedValueOnce({
      responseText: 'plan response',
      attachments: [],
      parsedData: JSON.parse(planResponse),
    });

    const event = {
      detail: {
        userId: 'user-1',
        isScheduledReview: true,
        traceId: 'trace-1',
      },
    };

    await handler(
      event as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );

    // Only covered gap should be assigned to track (which internally marks PLANNED)
    expect(gapOperationsMocks.assignGapToTrack).toHaveBeenCalled();
    const assignedGapIds = gapOperationsMocks.assignGapToTrack.mock.calls.map(
      (c: unknown[]) => c[1]
    );

    // Gap A should be assigned
    expect(assignedGapIds.some((id) => String(id).includes('1001'))).toBe(true);

    // Gap B (1002) was not in coveredGapIds and should NOT be assigned
    expect(assignedGapIds.some((id) => String(id).includes('1002'))).toBe(false);
  });

  it('should return COOLDOWN_ACTIVE if the same gapId was planned recently', async () => {
    const cooldownStore = JSON.stringify([
      { gapId: 'GAP#5001', expiresAt: Date.now() + 3_600_000 }, // still active
    ]);
    memoryMocks.getDistilledMemory.mockResolvedValue(cooldownStore);

    const event = {
      detail: {
        gapId: 'GAP#5001',
        task: 'some gap',
        userId: 'user-1',
      },
    };

    const result = await handler(
      event as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );
    expect(result).toMatchObject({ status: 'COOLDOWN_ACTIVE' });
    const { processEventWithAgent } = await import('../handlers/events/shared');
    expect(processEventWithAgent).not.toHaveBeenCalled();
  });

  it('should proceed if cooldown entry is expired', async () => {
    const cooldownStore = JSON.stringify([
      { gapId: 'GAP#5002', expiresAt: Date.now() - 1000 }, // expired
    ]);
    memoryMocks.getDistilledMemory.mockResolvedValue(cooldownStore);
    const { processEventWithAgent } = await import('../handlers/events/shared');
    vi.mocked(processEventWithAgent).mockResolvedValueOnce({
      responseText: 'STRATEGIC_PLAN: fix things',
      attachments: [],
      parsedData: { plan: 'fix things' },
    });

    const event = {
      detail: {
        gapId: 'GAP#5002',
        task: 'some gap description',
        userId: 'user-1',
      },
    };

    const result = await handler(
      event as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );
    expect(result).not.toMatchObject({ status: 'COOLDOWN_ACTIVE' });
    expect(processEventWithAgent).toHaveBeenCalled();
  });

  it('should NOT check cooldown for scheduled reviews (gapId is undefined)', async () => {
    // Even if there are cooldown entries, scheduled review should not be blocked
    const cooldownStore = JSON.stringify([
      { gapId: 'GAP#9999', expiresAt: Date.now() + 3_600_000 },
    ]);
    memoryMocks.getDistilledMemory.mockResolvedValue(cooldownStore);
    const { processEventWithAgent } = await import('../handlers/events/shared');
    vi.mocked(processEventWithAgent).mockResolvedValueOnce({
      responseText: 'STRATEGIC_PLAN: review result',
      attachments: [],
      parsedData: { plan: 'review result' },
    });

    const event = {
      detail: {
        userId: 'user-1',
        isScheduledReview: true,
      },
    };

    const result = await handler(
      event as unknown as Parameters<typeof handler>[0],
      {} as unknown as Parameters<typeof handler>[1]
    );
    // Should not return COOLDOWN_ACTIVE (that would block all scheduled reviews)
    expect(result).not.toMatchObject({ status: 'COOLDOWN_ACTIVE' });
  });

  it('should generate tool optimization gaps when planner recommends PRUNE/REPLACE', async () => {
    // Planner recommends pruning an anomalous tool
    const planResponse = JSON.stringify({
      status: 'SUCCESS',
      plan: 'System is stable, but pruning redundant search tool.',
      coveredGapIds: [],
      toolOptimizations: [
        {
          action: 'PRUNE',
          toolName: 'oldSearchTool',
          reason: 'High token usage and overlapping capability',
        },
      ],
    });
    const { processEventWithAgent } = await import('../handlers/events/shared');
    vi.mocked(processEventWithAgent).mockResolvedValueOnce({
      responseText: 'plan response',
      attachments: [],
      parsedData: JSON.parse(planResponse),
    });

    const event = {
      detail: {
        userId: 'user-1',
        isScheduledReview: true,
        traceId: 'trace-opt-1',
      },
    };

    await handler(event as any, {} as any);

    // Should call setGap for the optimization recommendation (UUID format)
    expect(memoryMocks.setGap).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
      expect.stringContaining('[TOOL_OPTIMIZATION] Action: PRUNE, Tool: oldSearchTool'),
      expect.any(Object),
      undefined
    );
  });
});

describe('Strategic Planner — tool loading (Bug 1 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryMocks.getDistilledMemory.mockResolvedValue(null);
    memoryMocks.getAllGaps.mockResolvedValue([]);
    registryMocks.getRawConfig.mockResolvedValue(undefined);
    registryMocks.getAgentConfig.mockResolvedValue({
      id: AGENT_TYPES.STRATEGIC_PLANNER,
      name: 'Strategic Planner',
      systemPrompt: 'Planner prompt',
      enabled: true,
    });
    vi.mocked(processEventWithAgent).mockResolvedValue({
      responseText: 'noop',
      attachments: [],
      parsedData: { status: 'SUCCESS', plan: 'noop' },
    });
  });

  it('should call getAgentTools with AGENT_TYPES.STRATEGIC_PLANNER, not "planner"', async () => {
    const event = {
      detail: {
        userId: 'user-1',
        isScheduledReview: true,
      },
    };

    await handler(event as any, {} as any);

    expect(registryUtilsMocks.getAgentTools).toHaveBeenCalledWith(AGENT_TYPES.STRATEGIC_PLANNER);
    expect(registryUtilsMocks.getAgentTools).not.toHaveBeenCalledWith('planner');
  });
});
