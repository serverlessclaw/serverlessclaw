import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventType, AgentType } from '../../lib/types/agent';

/**
 * Council of Agents Dispatch Logic Tests
 *
 * These tests verify that the Strategic Planner correctly dispatches
 * to the Critic Agent for peer review when impact/risk/complexity
 * exceeds the threshold (8).
 */

// ============================================================================
// Mock Setup
// ============================================================================

const memoryMocks = vi.hoisted(() => ({
  setGap: vi.fn().mockResolvedValue(undefined),
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  getAllGaps: vi.fn().mockResolvedValue([]),
  getDistilledMemory: vi.fn().mockResolvedValue(null),
  updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  addLesson: vi.fn().mockResolvedValue(undefined),
  incrementGapAttemptCount: vi.fn().mockResolvedValue(1),
  acquireGapLock: vi.fn().mockResolvedValue(true),
  getGapLock: vi.fn().mockResolvedValue(null),
  getFailurePatterns: vi.fn().mockResolvedValue([]),
  getGlobalLessons: vi.fn().mockResolvedValue([]),
  getFailedPlans: vi.fn().mockResolvedValue([]),
  recordFailedPlan: vi.fn().mockResolvedValue(undefined),
  getSummary: vi.fn().mockResolvedValue(null),
  updateSummary: vi.fn().mockResolvedValue(undefined),
  searchInsights: vi.fn().mockResolvedValue({ items: [], lastEvaluatedKey: null }),
  archiveStaleGaps: vi.fn().mockResolvedValue(0),
  createCollaboration: vi.fn().mockResolvedValue({
    collaborationId: 'collab-123',
    syntheticUserId: 'synth-user-123',
    success: true,
  }),
  addMessage: vi.fn().mockResolvedValue(undefined),
  closeCollaboration: vi.fn().mockResolvedValue(undefined),
}));

const gapOperationsMocks = vi.hoisted(() => ({
  assignGapToTrack: vi.fn().mockResolvedValue(undefined),
  determineTrack: vi.fn().mockReturnValue('FEATURE'),
}));

const emitTypedEventMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const sendOutboundMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const emitTaskEventMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const dispatchTaskMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
    MemoryTable: { name: 'test-memory' },
    ConfigTable: { name: 'test-config' },
    Deployer: { name: 'test-deployer' },
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

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn().mockResolvedValue({}) })) },
  QueryCommand: class {
    constructor(public input: unknown) {}
  },
  GetCommand: class {
    constructor(public input: unknown) {}
  },
  PutCommand: class {
    constructor(public input: unknown) {}
  },
  UpdateCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('../../lib/memory', () => ({
  DynamoMemory: class {
    setGap = memoryMocks.setGap;
    updateGapStatus = memoryMocks.updateGapStatus;
    getAllGaps = memoryMocks.getAllGaps;
    getDistilledMemory = memoryMocks.getDistilledMemory;
    updateDistilledMemory = memoryMocks.updateDistilledMemory;
    addLesson = memoryMocks.addLesson;
    incrementGapAttemptCount = memoryMocks.incrementGapAttemptCount;
    acquireGapLock = memoryMocks.acquireGapLock;
    getGapLock = memoryMocks.getGapLock;
    getFailurePatterns = memoryMocks.getFailurePatterns;
    getGlobalLessons = memoryMocks.getGlobalLessons;
    getFailedPlans = memoryMocks.getFailedPlans;
    recordFailedPlan = memoryMocks.recordFailedPlan;
    getSummary = memoryMocks.getSummary;
    updateSummary = memoryMocks.updateSummary;
    searchInsights = memoryMocks.searchInsights;
    archiveStaleGaps = memoryMocks.archiveStaleGaps;
    createCollaboration = memoryMocks.createCollaboration;
    addMessage = memoryMocks.addMessage;
    closeCollaboration = memoryMocks.closeCollaboration;
  },
}));

vi.mock('../../handlers/events/shared', () => ({
  wakeupInitiator: vi.fn().mockResolvedValue(undefined),
  getRecursionLimit: vi.fn().mockResolvedValue(15),
  handleRecursionLimitExceeded: vi.fn().mockResolvedValue(undefined),
  processEventWithAgent: vi.fn().mockImplementation((_userId, _agentId, _task, options) => {
    return Promise.resolve({
      responseText:
        options.handlerTitle === 'Strategic Planner'
          ? JSON.stringify({
              status: 'SUCCESS',
              plan: '1. Implement the Slack integration module by creating core/tools/slack.ts with sendMessage and searchMessages functions.\n2. Add the slackApiToken secret to SST config and link it to the relevant lambdas.\n3. Write unit tests in core/tools/slack.test.ts covering happy path and error cases.\n4. Register SLACK_SEND and SLACK_SEARCH in the TOOLS enum in core/lib/constants.ts.\n5. Deploy and run QA verification to confirm messages are delivered correctly to target channels.',
              coveredGapIds: ['GAP#1001'],
            })
          : 'Mock response',
      attachments: [],
      parsedData:
        options.handlerTitle === 'Strategic Planner'
          ? {
              status: 'SUCCESS',
              plan: '1. Implement the Slack integration module...',
              coveredGapIds: ['GAP#1001'],
            }
          : null,
    });
  }),
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: sendOutboundMessageMock,
}));

vi.mock('../../lib/utils/agent-helpers', () => ({
  extractPayload: vi.fn((event: unknown) => {
    const e = event as Record<string, unknown>;
    return (e.detail as Record<string, unknown>) || e;
  }),
  detectFailure: vi.fn((r: string) => r.startsWith('I encountered an internal error')),
  isTaskPaused: vi.fn((r: string) => r.startsWith('TASK_PAUSED')),
  loadAgentConfig: vi.fn().mockResolvedValue({
    id: 'strategic-planner',
    name: 'Strategic Planner',
    systemPrompt: 'Test prompt',
    enabled: true,
  }),
  extractBaseUserId: vi.fn((userId: string) =>
    userId.startsWith('CONV#') ? userId.split('#')[1] : userId
  ),
  getAgentContext: vi.fn().mockResolvedValue({
    memory: memoryMocks,
    provider: { call: vi.fn() },
  }),
  emitTaskEvent: emitTaskEventMock,
  parseStructuredResponse: (r: string) => JSON.parse(r),
}));

vi.mock('../../lib/utils/typed-emit', () => ({
  emitTypedEvent: emitTypedEventMock,
}));

vi.mock('../../lib/utils/agent-helpers/event-emitter', () => ({
  emitTaskEvent: emitTaskEventMock,
}));

vi.mock('../../lib/registry/index', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      id: 'strategic-planner',
      name: 'Strategic Planner',
      systemPrompt: 'Test prompt',
      enabled: true,
    }),
    getRawConfig: vi.fn().mockResolvedValue(undefined),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
    recordToolUsage: vi.fn().mockResolvedValue(undefined),
    getRetentionDays: vi.fn().mockResolvedValue(30),
  },
}));

vi.mock('../../lib/scheduler', () => ({
  DynamicScheduler: {
    ensureProactiveGoal: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../lib/tracer', () => ({
  ClawTracer: {
    getTrace: vi.fn().mockResolvedValue([{ source: 'dashboard', steps: [] }]),
  },
}));

vi.mock('../../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
  TOOLS: { dispatchTask: { execute: dispatchTaskMock } },
}));

vi.mock('../../tools/registry-utils', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../tools/knowledge/agent', () => ({
  dispatchTask: { execute: dispatchTaskMock },
}));

vi.mock('../../lib/providers/index', () => ({
  ProviderManager: class {},
}));

vi.mock('../../lib/agent', () => ({
  Agent: class {
    stream = async function* () {
      yield {
        content: JSON.stringify({
          status: 'SUCCESS',
          plan: '1. Implement the Slack integration module by creating core/tools/slack.ts with sendMessage and searchMessages functions.\n2. Add the slackApiToken secret to SST config and link it to the relevant lambdas.\n3. Write unit tests in core/tools/slack.test.ts covering happy path and error cases.\n4. Register SLACK_SEND and SLACK_SEARCH in the TOOLS enum in core/lib/constants.ts.\n5. Deploy and run QA verification to confirm messages are delivered correctly to target channels.',
          coveredGapIds: ['GAP#1001'],
        }),
      };
    };
    process = vi.fn().mockResolvedValue({
      responseText: JSON.stringify({
        status: 'SUCCESS',
        plan: '1. Implement the Slack integration module by creating core/tools/slack.ts with sendMessage and searchMessages functions.\n2. Add the slackApiToken secret to SST config and link it to the relevant lambdas.\n3. Write unit tests in core/tools/slack.test.ts covering happy path and error cases.\n4. Register SLACK_SEND and SLACK_SEARCH in the TOOLS enum in core/lib/constants.ts.\n5. Deploy and run QA verification to confirm messages are delivered correctly to target channels.',
        coveredGapIds: ['GAP#1001'],
      }),
    });
  },
}));

vi.mock('../strategic-planner/evolution', () => ({
  getEvolutionMode: vi.fn().mockResolvedValue('auto'),
  recordCooldown: vi.fn().mockResolvedValue(undefined),
  isGapInCooldown: vi.fn().mockResolvedValue(false),
}));

vi.mock('../strategic-planner/prompts', () => ({
  buildProactiveReviewPrompt: vi.fn().mockResolvedValue({
    prompt: 'Test prompt',
    shouldRun: true,
  }),
  buildReactivePrompt: vi.fn().mockReturnValue('Test reactive prompt'),
  buildTelemetry: vi.fn().mockReturnValue('Test telemetry'),
}));

vi.mock('../../lib/memory/gap-operations', () => ({
  assignGapToTrack: gapOperationsMocks.assignGapToTrack,
  determineTrack: gapOperationsMocks.determineTrack,
}));

// ============================================================================
// Tests: Council Threshold Logic
// ============================================================================

describe('Council of Agents — Threshold Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should dispatch to Council when impact >= 8', async () => {
    const { handler } = await import('../strategic-planner');

    const event = {
      detail: {
        userId: 'user-1',
        gapId: 'GAP#1001',
        task: 'Add Slack integration',
        metadata: {
          impact: 9,
          risk: 5,
          complexity: 6,
        },
        traceId: 'trace-1',
        sessionId: 'session-1',
      },
    };

    await handler(event as any, {} as any);

    // Verify PARALLEL_TASK_DISPATCH was emitted
    expect(emitTypedEventMock).toHaveBeenCalledWith(
      'strategic-planner',
      EventType.PARALLEL_TASK_DISPATCH,
      expect.objectContaining({
        userId: 'user-1',
        tasks: expect.arrayContaining([
          expect.objectContaining({
            agentId: AgentType.CRITIC,
            metadata: expect.objectContaining({ reviewMode: 'security' }),
          }),
          expect.objectContaining({
            agentId: AgentType.CRITIC,
            metadata: expect.objectContaining({ reviewMode: 'performance' }),
          }),
          expect.objectContaining({
            agentId: AgentType.CRITIC,
            metadata: expect.objectContaining({ reviewMode: 'architect' }),
          }),
        ]),
        aggregationType: 'agent_guided',
      })
    );

    // Verify direct dispatch to Coder was NOT called
    expect(dispatchTaskMock).not.toHaveBeenCalled();
  });

  it('should dispatch to Council when risk >= 8', async () => {
    const { handler } = await import('../strategic-planner');

    const event = {
      detail: {
        userId: 'user-1',
        gapId: 'GAP#1001',
        task: 'Add Slack integration',
        metadata: {
          impact: 5,
          risk: 9,
          complexity: 6,
        },
        traceId: 'trace-1',
        sessionId: 'session-1',
      },
    };

    await handler(event as any, {} as any);

    expect(emitTypedEventMock).toHaveBeenCalledWith(
      'strategic-planner',
      EventType.PARALLEL_TASK_DISPATCH,
      expect.anything()
    );
  });

  it('should dispatch to Council when complexity >= 8', async () => {
    const { handler } = await import('../strategic-planner');

    const event = {
      detail: {
        userId: 'user-1',
        gapId: 'GAP#1001',
        task: 'Add Slack integration',
        metadata: {
          impact: 5,
          risk: 5,
          complexity: 9,
        },
        traceId: 'trace-1',
        sessionId: 'session-1',
      },
    };

    await handler(event as any, {} as any);

    expect(emitTypedEventMock).toHaveBeenCalledWith(
      'strategic-planner',
      EventType.PARALLEL_TASK_DISPATCH,
      expect.anything()
    );
  });

  it('should skip Council and dispatch directly to Coder when all metrics < 8', async () => {
    const { handler } = await import('../strategic-planner');

    const event = {
      detail: {
        userId: 'user-1',
        gapId: 'GAP#1001',
        task: 'Add Slack integration',
        metadata: {
          impact: 5,
          risk: 5,
          complexity: 5,
        },
        traceId: 'trace-1',
        sessionId: 'session-1',
      },
    };

    await handler(event as any, {} as any);

    // Verify PARALLEL_TASK_DISPATCH was NOT emitted
    expect(emitTypedEventMock).not.toHaveBeenCalled();

    // Verify direct dispatch to Coder was called
    expect(dispatchTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AgentType.CODER,
        userId: 'user-1',
      })
    );
  });
});

// ============================================================================
// Tests: Council Task Structure
// ============================================================================

describe('Council of Agents — Task Structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should dispatch exactly 3 critic tasks (security, performance, architect)', async () => {
    const { handler } = await import('../strategic-planner');

    const event = {
      detail: {
        userId: 'user-1',
        gapId: 'GAP#1001',
        task: 'Add Slack integration',
        metadata: {
          impact: 9,
          risk: 5,
          complexity: 6,
        },
        traceId: 'trace-1',
        sessionId: 'session-1',
      },
    };

    await handler(event as any, {} as any);

    const parallelCall = emitTypedEventMock.mock.calls.find(
      (call: unknown[]) => call[1] === EventType.PARALLEL_TASK_DISPATCH
    );

    expect(parallelCall).toBeDefined();
    const tasks = parallelCall![2].tasks;
    expect(tasks).toHaveLength(3);

    const reviewModes = tasks.map(
      (t: { metadata: { reviewMode: string } }) => t.metadata.reviewMode
    );
    expect(reviewModes).toContain('security');
    expect(reviewModes).toContain('performance');
    expect(reviewModes).toContain('architect');
  });

  it('should include plan content in each critic task', async () => {
    const { handler } = await import('../strategic-planner');

    const event = {
      detail: {
        userId: 'user-1',
        gapId: 'GAP#1001',
        task: 'Add Slack integration',
        metadata: {
          impact: 9,
          risk: 5,
          complexity: 6,
        },
        traceId: 'trace-1',
        sessionId: 'session-1',
      },
    };

    await handler(event as any, {} as any);

    const parallelCall = emitTypedEventMock.mock.calls.find(
      (call: unknown[]) => call[1] === EventType.PARALLEL_TASK_DISPATCH
    );

    const tasks = parallelCall![2].tasks;
    for (const task of tasks) {
      expect(task.task).toContain('Implement the Slack integration module');
    }
  });

  it('should use agent_guided aggregation type', async () => {
    const { handler } = await import('../strategic-planner');

    const event = {
      detail: {
        userId: 'user-1',
        gapId: 'GAP#1001',
        task: 'Add Slack integration',
        metadata: {
          impact: 9,
          risk: 5,
          complexity: 6,
        },
        traceId: 'trace-1',
        sessionId: 'session-1',
      },
    };

    await handler(event as any, {} as any);

    const parallelCall = emitTypedEventMock.mock.calls.find(
      (call: unknown[]) => call[1] === EventType.PARALLEL_TASK_DISPATCH
    );

    expect(parallelCall![2].aggregationType).toBe('agent_guided');
    expect(parallelCall![2].aggregationPrompt).toContain('Synthesize');
  });
});

// ============================================================================
// Tests: Council Notification
// ============================================================================

describe('Council of Agents — User Notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should notify user when Council review is initiated', async () => {
    const { handler } = await import('../strategic-planner');

    const event = {
      detail: {
        userId: 'user-1',
        gapId: 'GAP#1001',
        task: 'Add Slack integration',
        metadata: {
          impact: 9,
          risk: 5,
          complexity: 6,
        },
        traceId: 'trace-1',
        sessionId: 'session-1',
      },
    };

    await handler(event as any, {} as any);

    expect(sendOutboundMessageMock).toHaveBeenCalledWith(
      'strategic-planner',
      'user-1',
      expect.stringContaining('Council of Agents Review Initiated'),
      ['user-1'],
      'session-1',
      'Strategic Planner',
      undefined
    );
  });
});

// ============================================================================
// Tests: Edge Cases
// ============================================================================

describe('Council of Agents — Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not dispatch to Council when gapId is missing (reactive mode)', async () => {
    const { handler } = await import('../strategic-planner');

    const event = {
      detail: {
        userId: 'user-1',
        task: 'Add Slack integration',
        metadata: {
          impact: 9,
          risk: 5,
          complexity: 6,
        },
        traceId: 'trace-1',
        sessionId: 'session-1',
      },
    };

    await handler(event as any, {} as any);

    // In reactive mode without gapId, no Council dispatch should happen
    // because processedGapIds will be empty
    expect(emitTypedEventMock).not.toHaveBeenCalled();
  });
});
