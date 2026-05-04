import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler as strategicPlannerHandler } from '../agents/strategic-planner';
import { handler as coderHandler } from '../agents/coder';
import { getCircuitBreaker, resetCircuitBreakerInstance } from '../lib/safety/circuit-breaker';
import { TRACE_TYPES } from '../lib/constants';

// Mock AWS SDK first - Variables used in vi.mock MUST start with 'vi_'
const { vi_mockSend, vi_mockAddTraceStep } = vi.hoisted(() => ({
  vi_mockSend: vi.fn(),
  vi_mockAddTraceStep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {
    send = vi_mockSend;
  },
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: class {},
  PutCommand: class {},
  UpdateCommand: class {},
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({
      send: vi_mockSend,
    })),
  },
}));

// Mock trace helper
vi.mock('../lib/utils/trace-helper', () => ({
  addTraceStep: vi_mockAddTraceStep,
  updateTraceMetadata: vi.fn().mockResolvedValue(undefined),
  updateTraceStatus: vi.fn().mockResolvedValue(undefined),
}));

// Mock everything needed for agent handlers
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/utils/agent-helpers', async () => {
  const actual = (await vi.importActual('../lib/utils/agent-helpers')) as any;
  return {
    ...actual,
    loadAgentConfig: vi.fn().mockResolvedValue({
      id: 'strategic-planner',
      name: 'TestAgent',
      systemPrompt: 'Test',
      enabled: true,
    }),
    getAgentContext: vi.fn().mockResolvedValue({
      memory: {
        getDistilledMemory: vi.fn(),
        updateDistilledMemory: vi.fn(),
        setGap: vi.fn(),
        getGapLock: vi.fn(),
        updateGapStatusPLANNED: vi.fn(),
        updateGapStatus: vi.fn(),
        getFailurePatterns: vi.fn().mockResolvedValue([]),
        acquireGapLock: vi.fn().mockResolvedValue(true),
        getScopedUserId: vi.fn().mockImplementation((uid, wid) => (wid ? `${uid}#${wid}` : uid)),
      },
      provider: {
        getProvider: vi.fn().mockReturnValue({
          chat: vi.fn().mockResolvedValue({
            content: '{"status":"SUCCESS", "plan":"Test plan", "coveredGapIds": ["GAP-1"]}',
          }),
          stream: vi.fn().mockImplementation(async function* () {
            yield {
              content: '{"status":"SUCCESS", "plan":"Test plan", "coveredGapIds": ["GAP-1"]}',
            };
          }),
        }),
      },
    }),
    initAgent: vi.fn().mockResolvedValue({
      config: { id: 'coder', name: 'TestAgent', enabled: true },
      memory: {
        updateGapStatus: vi.fn(),
        getScopedUserId: vi.fn().mockImplementation((uid, wid) => (wid ? `${uid}#${wid}` : uid)),
      },
      agent: {
        process: vi.fn().mockResolvedValue({
          responseText: '{"status":"SUCCESS", "response":"Code fixed"}',
          attachments: [],
        }),
      },
    }),
  };
});

vi.mock('../lib/agent', () => ({
  Agent: class {
    constructor() {}
    stream() {
      return (async function* () {
        yield {
          content:
            '{"status":"SUCCESS", "plan":"Implement comprehensive search integration across all Slack channels. ' +
            'This solution requires a multi-phase approach: Phase 1 establishes the core connector infrastructure with ' +
            'proper authentication and rate limiting. Phase 2 adds advanced filtering capabilities including date range, ' +
            'user, and channel-level granularity. Phase 3 implements relevance scoring and caching for optimal performance. ' +
            'Each phase includes integration tests and documentation updates. The connector follows existing patterns and ' +
            'handles edge cases gracefully with proper error boundaries.", "coveredGapIds": ["GAP-1"]}',
        };
      })();
    }
    process() {
      return Promise.resolve({
        responseText:
          '{"status":"SUCCESS", "plan":"Implement comprehensive search integration across all Slack channels. ' +
          'This solution requires a multi-phase approach: Phase 1 establishes the core connector infrastructure with ' +
          'proper authentication and rate limiting. Phase 2 adds advanced filtering capabilities including date range, ' +
          'user, and channel-level granularity. Phase 3 implements relevance scoring and caching for optimal performance. ' +
          'Each phase includes integration tests and documentation updates. The connector follows existing patterns and ' +
          'handles edge cases gracefully with proper error boundaries.", "coveredGapIds": ["GAP-1"]}',
        attachments: [],
      });
    }
  },
}));

vi.mock('../lib/utils/agent-helpers/event-emitter', () => ({
  emitTaskEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../tools/registry-utils', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/utils/typed-emit', () => ({
  emitTypedEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/utils/workspace-manager', () => ({
  createWorkspace: vi.fn().mockResolvedValue('/tmp/mock-workspace'),
  createMergeWorkspace: vi.fn().mockResolvedValue('/tmp/mock-merge-dir'),
  cleanupWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'ConfigTable' },
    TraceTable: { name: 'TraceTable' },
  },
}));

describe('Tracing Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'chdir').mockImplementation(() => {});
    resetCircuitBreakerInstance();
  });

  describe('Strategic Planner Traces', () => {
    it('should emit PLAN_GENERATED trace after successful planning', async () => {
      await strategicPlannerHandler(
        {
          detail: {
            userId: 'user-1',
            task: 'Fix the bug',
            traceId: 'trace-123',
          },
        } as any,
        {} as any
      );

      expect(vi_mockAddTraceStep).toHaveBeenCalledWith(
        'trace-123',
        'root',
        expect.objectContaining({
          type: TRACE_TYPES.PLAN_GENERATED,
        })
      );
    });

    it('should emit COUNCIL_REVIEW trace when processing council results', async () => {
      const { getAgentContext } = await import('../lib/utils/agent-helpers');
      const { memory } = (await getAgentContext()) as any;
      memory.getDistilledMemory.mockResolvedValue(JSON.stringify({ plan: 'Test', gapIds: [] }));

      await strategicPlannerHandler(
        {
          detail: {
            userId: 'user-1',
            task: '[COUNCIL_REVIEW_RESULT] VERDICT: APPROVED',
            traceId: 'council-trace-123',
          },
        } as any,
        {} as any
      );

      expect(vi_mockAddTraceStep).toHaveBeenCalledWith(
        'council-trace-123',
        'root',
        expect.objectContaining({
          type: TRACE_TYPES.COUNCIL_REVIEW,
          content: expect.objectContaining({ verdict: 'APPROVED' }),
        })
      );
    });
  });

  describe('Coder Agent Traces', () => {
    it('should emit CODE_WRITTEN trace after successful coding', async () => {
      await coderHandler(
        {
          detail: {
            userId: 'user-1',
            task: 'Write a function',
            traceId: 'trace-456',
          },
        } as any,
        {} as any
      );

      expect(vi_mockAddTraceStep).toHaveBeenCalledWith(
        'trace-456',
        'root',
        expect.objectContaining({
          type: TRACE_TYPES.CODE_WRITTEN,
        })
      );
    });
  });

  describe('Circuit Breaker Traces', () => {
    it('should emit CIRCUIT_BREAKER trace on recovery', async () => {
      // 1. Mock loadState for half_open (first call in recordSuccess)
      vi_mockSend.mockResolvedValueOnce({
        Item: {
          key: 'circuit_breaker_state',
          value: {
            state: 'half_open',
            failures: [],
            halfOpenProbes: 1,
            lastStateChange: Date.now(),
            version: 1,
          },
        },
      });

      // 2. Mock saveState (PutCommand)
      vi_mockSend.mockResolvedValueOnce({});

      const cb = getCircuitBreaker();
      await cb.recordSuccess({ traceId: 'system' });

      expect(vi_mockAddTraceStep).toHaveBeenCalledWith(
        'system',
        'root',
        expect.objectContaining({
          type: TRACE_TYPES.CIRCUIT_BREAKER,
          content: expect.objectContaining({ newState: 'closed' }),
        })
      );
    });
  });
});
