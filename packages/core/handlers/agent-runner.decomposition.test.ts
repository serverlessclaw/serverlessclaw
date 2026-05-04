import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './agent-runner';
import { SWARM } from '../lib/constants/system';
import { AGENT_TYPES, EventType } from '../lib/types/agent';

// Mock helpers
const { mockEmitTypedEvent } = vi.hoisted(() => ({
  mockEmitTypedEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/utils/typed-emit', () => ({
  emitTypedEvent: mockEmitTypedEvent,
}));

const mockAgent = {
  process: vi.fn(),
  stream: vi.fn(),
};

vi.mock('../lib/utils/agent-helpers', () => ({
  extractPayload: vi.fn((x) => x),
  extractBaseUserId: vi.fn((x) => x),
  isE2ETest: vi.fn(() => true),
  detectFailure: vi.fn(() => false),
  isTaskPaused: vi.fn((resp) => resp?.startsWith('TASK_PAUSED')),
  validatePayload: vi.fn(() => true),
  buildProcessOptions: vi.fn((x) => ({ ...x })),
  initAgent: vi.fn(async () => ({
    config: { category: 'utility', defaultCommunicationMode: 'json' },
    agent: mockAgent,
  })),
}));

vi.mock('../lib/utils/agent-helpers/event-emitter', () => ({
  emitTaskEvent: vi.fn(),
}));

// Mock DistributedState
vi.mock('../lib/utils/distributed-state', () => ({
  DistributedState: {
    isCircuitOpen: vi.fn().mockResolvedValue(false),
    consumeToken: vi.fn().mockResolvedValue(true),
  },
}));

// Mock ddb-client
vi.mock('../lib/utils/ddb-client', () => ({
  getMemoryTableName: vi.fn(() => 'test-memory-table'),
  getConfigTableName: vi.fn(() => 'test-config-table'),
  getDocClient: vi.fn(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('../lib/registry/AgentRegistry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn(async () => ({ enabled: true })),
    getFallbackAgents: vi.fn(() => ['superclaw', 'facilitator']),
  },
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../lib/recursion-tracker', () => ({
  incrementRecursionDepth: vi.fn(async () => 1),
  getRecursionDepth: vi.fn(async () => 0),
  clearRecursionStack: vi.fn(async () => undefined),
  getRecursionLimit: vi.fn(async () => 15),
}));

describe('AgentRunner Decomposition Logic', () => {
  const fakeContext = { awsRequestId: 'request-123' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseEvent = {
    'detail-type': 'dynamic_superclaw_task',
    detail: {
      userId: 'user-1',
      task: 'Original Task',
      traceId: 'trace-1',
      sessionId: 'session-1',
      depth: 0,
    },
  } as any;

  it('triggers decomposition when response contains mission markers', async () => {
    mockAgent.process.mockResolvedValue({
      responseText: `I have analyzed the requirements and established a multi-step mission.
      
### Goal: RESEARCHER - Document the existing auth flow
We need to understand the current implementation of the authentication system to ensure compatibility with the new login module. This includes checking the DynamoDB schema and the existing JWT validation logic.

### Goal: CODER - Implement the new login module
Once the research is complete, we will implement the new login module using the established patterns. This involves creating a new Lambda function and updating the API Gateway configuration to route requests to the new module.`,
      attachments: [],
    });

    const result = await handler(baseEvent, fakeContext);

    expect(result).toContain('TASK_PAUSED: I have decomposed this mission');
    expect(mockEmitTypedEvent).toHaveBeenCalledWith(
      'superclaw',
      EventType.PARALLEL_TASK_DISPATCH,
      expect.objectContaining({
        tasks: expect.arrayContaining([
          expect.objectContaining({ agentId: AGENT_TYPES.RESEARCHER }),
          expect.objectContaining({ agentId: AGENT_TYPES.CODER }),
        ]),
      })
    );
  });

  it('skips decomposition when depth reaches MAX_RECURSIVE_DEPTH', async () => {
    mockAgent.process.mockResolvedValue({
      responseText: '### Goal: Final Step\n1. This would normally decompose',
      attachments: [],
    });

    const deepEvent = {
      ...baseEvent,
      detail: { ...baseEvent.detail, depth: SWARM.MAX_RECURSIVE_DEPTH },
    };

    const result = await handler(deepEvent, fakeContext);

    // Should return result normally, not pause for decomposition
    expect(result).toContain('### Goal:');
    expect(mockEmitTypedEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      EventType.PARALLEL_TASK_DISPATCH,
      expect.anything()
    );
  });

  it('skips decomposition if the agent already returned TASK_PAUSED (Idempotency)', async () => {
    mockAgent.process.mockResolvedValue({
      responseText: 'TASK_PAUSED: I already delegated this technical research to the specialist.',
      attachments: [],
    });

    const result = await handler(baseEvent, fakeContext);

    // Should return the original pause message, not the decomposition message
    expect(result).toBe(
      'TASK_PAUSED: I already delegated this technical research to the specialist.'
    );
    expect(mockEmitTypedEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      EventType.PARALLEL_TASK_DISPATCH,
      expect.anything()
    );
  });

  it('skips decomposition for continuation events (Synthesis Phase)', async () => {
    mockAgent.process.mockResolvedValue({
      responseText: '### Goal: Redundant Decomposition\n1. Skip me',
      attachments: [],
    });

    const continuationEvent = {
      ...baseEvent,
      detail: { ...baseEvent.detail, isContinuation: true },
    };

    const result = await handler(continuationEvent, fakeContext);

    expect(result).toContain('### Goal:');
    expect(mockEmitTypedEvent).not.toHaveBeenCalled();
  });
});
