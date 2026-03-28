import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './strategic-planner';
import { EventType } from '../lib/types/agent';

const mocks = vi.hoisted(() => {
  const memoryMocks = {
    updateGapStatus: vi.fn().mockResolvedValue(undefined),
    getAllGaps: vi.fn(),
    getDistilledMemory: vi.fn(),
    updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
    getFailurePatterns: vi.fn().mockResolvedValue([]),
    setGap: vi.fn().mockResolvedValue(undefined),
    searchInsights: vi.fn().mockResolvedValue({ items: [], lastEvaluatedKey: null }),
    archiveStaleGaps: vi.fn().mockResolvedValue(0),
    acquireGapLock: vi.fn().mockResolvedValue(true),
    getGapLock: vi.fn().mockResolvedValue(null),
    getGlobalLessons: vi.fn().mockResolvedValue([]),
    getFailedPlans: vi.fn().mockResolvedValue([]),
    closeCollaboration: vi.fn().mockResolvedValue(undefined),
    updateDistilledMemoryBatch: vi.fn().mockResolvedValue(undefined),
    createCollaboration: vi.fn().mockResolvedValue({
      collaborationId: 'collab-456',
      syntheticUserId: 'synth-user-123',
    }),
    addMessage: vi.fn().mockResolvedValue(undefined),
  };

  const agentMocks = {
    process: vi.fn(),
    executeTool: vi.fn(),
  };

  class MockMemory {
    updateGapStatus = memoryMocks.updateGapStatus;
    getAllGaps = memoryMocks.getAllGaps;
    getDistilledMemory = memoryMocks.getDistilledMemory;
    updateDistilledMemory = memoryMocks.updateDistilledMemory;
    getFailurePatterns = memoryMocks.getFailurePatterns;
    setGap = memoryMocks.setGap;
    searchInsights = memoryMocks.searchInsights;
    archiveStaleGaps = memoryMocks.archiveStaleGaps;
    acquireGapLock = memoryMocks.acquireGapLock;
    getGapLock = memoryMocks.getGapLock;
    getGlobalLessons = memoryMocks.getGlobalLessons;
    getFailedPlans = memoryMocks.getFailedPlans;
    closeCollaboration = memoryMocks.closeCollaboration;
    updateDistilledMemoryBatch = memoryMocks.updateDistilledMemoryBatch;
    createCollaboration = memoryMocks.createCollaboration;
    addMessage = memoryMocks.addMessage;
  }

  class MockAgent {
    process(...args: any[]) {
      return agentMocks.process(...args);
    }
    async *stream(...args: any[]) {
      const result = await agentMocks.process(...args);
      yield { content: result.responseText };
    }
    async executeTool(name: string, args: any) {
      return agentMocks.executeTool(name, args);
    }
  }

  return { memoryMocks, agentMocks, MockMemory, MockAgent };
});

vi.mock('../lib/memory', () => ({
  DynamoMemory: mocks.MockMemory,
}));

vi.mock('../lib/agent', () => ({
  Agent: mocks.MockAgent,
}));

vi.mock('../lib/utils/typed-emit', () => ({
  emitTypedEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
    MemoryTable: { name: 'test-memory' },
    TraceTable: { name: 'test-trace' },
  },
}));

vi.mock('../lib/utils/agent-helpers', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    loadAgentConfig: vi.fn().mockResolvedValue({
      id: 'strategic_planner',
      name: 'Strategic Planner',
      enabled: true,
    }),
    initAgent: vi.fn().mockImplementation(async () => {
      return {
        config: { id: 'strategic_planner', name: 'Strategic Planner', enabled: true },
        agent: new mocks.MockAgent() as any,
        memory: new mocks.MockMemory() as any,
      };
    }),
    getAgentContext: vi.fn().mockImplementation(async () => {
      return {
        memory: new mocks.MockMemory() as any,
        provider: {},
      };
    }),
  };
});

describe('Strategic Planner Council Collaboration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentMocks.executeTool.mockImplementation(async (name) => {
      if (name === 'createCollaboration')
        return JSON.stringify({ success: true, collaborationId: 'collab-456' });
      return JSON.stringify({ success: true });
    });
  });

  it('should create a collaboration and dispatch parallel tasks when plan is high risk', async () => {
    // 1. Setup high risk plan
    const plan = 'Fix the database schema';
    const _planId = 'plan-123';
    mocks.agentMocks.process.mockResolvedValue({
      responseText: plan, // Reactive review returns raw plan text
    });

    const event = {
      detail: {
        userId: 'user-1',
        task: 'Handle gap GAP#1',
        gapId: '1',
        traceId: 'trace-789',
        metadata: { impact: 9, risk: 9, complexity: 9 },
      },
    };

    // 2. Execute handler
    await handler(event as any, {} as any);

    // 3. Verify collaboration was created via memory
    expect(mocks.memoryMocks.createCollaboration).toHaveBeenCalledWith(
      'user-1',
      'agent',
      expect.objectContaining({
        name: expect.stringContaining('Council Review'),
        description: expect.stringContaining('Multi-party peer review'),
        tags: expect.arrayContaining(['council', 'review']),
      })
    );

    // 4. Verify plan was written to collaboration via memory
    expect(mocks.memoryMocks.addMessage).toHaveBeenCalledWith(
      'synth-user-123',
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining(plan),
        agentName: 'strategic-planner',
      })
    );

    // 5. Verify parallel tasks were dispatched with collaborationId
    const { emitTypedEvent } = await import('../lib/utils/typed-emit');
    expect(emitTypedEvent).toHaveBeenCalledWith(
      'planner.agent',
      EventType.PARALLEL_TASK_DISPATCH,
      expect.objectContaining({
        tasks: expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({ collaborationId: 'collab-456' }),
          }),
        ]),
      })
    );
  });

  it('should close collaboration during Council review continuation', async () => {
    // 1. Setup continuation event
    const event = {
      detail: {
        userId: 'user-1',
        task: '[COUNCIL_REVIEW_RESULT] VERDICT: APPROVED. Plan is good.',
        traceId: 'trace-789',
      },
    };

    // 2. Setup memory to return saved council data
    mocks.memoryMocks.getDistilledMemory.mockResolvedValue(
      JSON.stringify({
        plan: 'Original Plan',
        gapIds: ['1'],
        collaborationId: 'collab-456',
        planId: 'plan-123',
      })
    );

    // 3. Execute handler
    await handler(event as any, {} as any);

    // 4. Verify closeCollaboration was called via memory
    expect(mocks.memoryMocks.closeCollaboration).toHaveBeenCalledWith(
      'collab-456',
      'user-1',
      'agent'
    );
  });
});
