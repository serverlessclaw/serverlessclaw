import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './cognition-reflector';
import { MessageRole, GapStatus } from '../lib/types/index';

const mocks = vi.hoisted(() => ({
  updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
  addLesson: vi.fn().mockResolvedValue(undefined),
  setGap: vi.fn().mockResolvedValue(undefined),
  updateGapStatus: vi.fn().mockResolvedValue(undefined),
  updateGapMetadata: vi.fn().mockResolvedValue(undefined),
  agentProcess: vi.fn(),
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    getDistilledMemory = vi.fn().mockResolvedValue('Old facts');
    getAllGaps = vi.fn().mockResolvedValue([]);
    updateDistilledMemory = mocks.updateDistilledMemory;
    addLesson = mocks.addLesson;
    updateGapStatus = mocks.updateGapStatus;
    getFailurePatterns = vi.fn().mockResolvedValue([]);
    getSummary = vi.fn().mockResolvedValue(null);
    updateSummary = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../lib/providers/index', () => ({
  ProviderManager: class {
    call = vi.fn();
  },
}));

vi.mock('../lib/agent', () => ({
  Agent: class {
    process = mocks.agentProcess;
    stream = async function* (this: any) {
      // eslint-disable-next-line prefer-rest-params
      const result = await mocks.agentProcess.apply(this, arguments as any);
      yield { content: result.responseText };
    };
  },
}));

vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({
      id: 'cognition-reflector',
      name: 'Reflector',
      systemPrompt: 'Reflector Prompt',
      enabled: true,
    }),
  },
}));

vi.mock('../tools/index', () => ({
  getAgentTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/tracer', () => ({
  ClawTracer: {
    getTrace: vi.fn().mockResolvedValue([{ source: 'dashboard', steps: [] }]),
  },
}));

// Mock EventBridge
vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: class {
    send = vi.fn().mockResolvedValue({});
  },
  PutEventsCommand: class {
    constructor(public input: any) {}
  },
}));

// Mock SST Resource — required to prevent typedResource.AgentBus.name from throwing
vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
    MemoryTable: { name: 'test-memory' },
    ConfigTable: { name: 'test-config' },
    TraceTable: { name: 'test-trace' },
  },
}));

// Mock agent-helpers: keep pure fn behaviour, stub async side-effects
vi.mock('../lib/utils/agent-helpers', () => ({
  // extractPayload must return the outer event so handler can access .detail on it
  extractPayload: vi.fn((event: unknown) => event),
  detectFailure: vi.fn((r: string) => r.startsWith('I encountered an internal error')),
  isTaskPaused: vi.fn((r: string) => r.startsWith('TASK_PAUSED')),
  loadAgentConfig: vi.fn().mockResolvedValue({
    id: 'cognition-reflector',
    name: 'Reflector',
    systemPrompt: 'Reflector Prompt',
    enabled: true,
  }),
  extractBaseUserId: vi.fn((userId: string) =>
    userId.startsWith('CONV#') ? userId.split('#')[1] : userId
  ),
  emitTaskEvent: vi.fn().mockResolvedValue(undefined),
  parseStructuredResponse: (r: string) => JSON.parse(r),
  getAgentContext: vi.fn().mockResolvedValue({
    memory: {
      getDistilledMemory: vi.fn().mockResolvedValue('Old facts'),
      getAllGaps: vi.fn().mockResolvedValue([]),
      updateDistilledMemory: mocks.updateDistilledMemory,
      addLesson: mocks.addLesson,
      setGap: mocks.setGap,
      updateGapStatus: mocks.updateGapStatus,
      updateGapMetadata: mocks.updateGapMetadata,
      getFailurePatterns: vi.fn().mockResolvedValue([]),
      getSummary: vi.fn().mockResolvedValue(null),
      updateSummary: vi.fn().mockResolvedValue(undefined),
    },
    provider: {
      call: vi.fn(),
    },
  }),
}));

describe('Cognition Reflector Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse reflection JSON and update memory', async () => {
    const mockReflectionResponse = JSON.stringify({
      facts: 'Updated facts including SuperPeng',
      lessons: [{ content: 'New lesson', impact: 8 }],
      gaps: [{ content: 'New gap', impact: 5, urgency: 5 }],
      resolvedGapIds: ['gap-123'],
    });

    mocks.agentProcess.mockResolvedValue({ responseText: mockReflectionResponse });

    const event = {
      detail: {
        userId: 'user-123',
        conversation: [
          { role: MessageRole.USER, content: 'Call me SuperPeng' },
          { role: MessageRole.ASSISTANT, content: 'Got it SuperPeng' },
        ],
        traceId: 'trace-456',
      },
    };

    await handler(event as any, {} as any);

    // Verify memory updates
    expect(mocks.updateDistilledMemory).toHaveBeenCalledWith(
      'user-123',
      'Updated facts including SuperPeng'
    );
    expect(mocks.addLesson).toHaveBeenCalledWith('user-123', 'New lesson', expect.any(Object));
    expect(mocks.setGap).toHaveBeenCalledWith(expect.any(String), 'New gap', expect.any(Object));
    expect(mocks.updateGapStatus).toHaveBeenCalledWith('gap-123', GapStatus.DONE);
  });

  it('should generate gap IDs as UUIDs (no compound IDs)', async () => {
    const mockReflectionResponse = JSON.stringify({
      facts: 'facts',
      lessons: [],
      gaps: [
        { content: 'Gap one', impact: 5 },
        { content: 'Gap two', impact: 3 },
      ],
      resolvedGapIds: [],
    });

    mocks.agentProcess.mockResolvedValue({ responseText: mockReflectionResponse });

    const event = {
      detail: {
        userId: 'user-123',
        conversation: [{ role: MessageRole.USER, content: 'test' }],
      },
    };

    await handler(event as any, {} as any);

    // Both gaps should have been created
    expect(mocks.setGap).toHaveBeenCalledTimes(2);

    // Each gap ID should be a UUID string (contains hyphens, not numeric)
    const gapIds = mocks.setGap.mock.calls.map((call: unknown[]) => call[0]);
    for (const gapId of gapIds) {
      expect(gapId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('should handle non-JSON responses gracefully', async () => {
    mocks.agentProcess.mockResolvedValue({ responseText: 'I updated the facts for you.' });

    const event = {
      detail: {
        userId: 'user-123',
        conversation: [],
      },
    };

    const result = await handler(event as any, {} as any);
    expect(result).toBe('I updated the facts for you.');

    // Memory should NOT be updated with structured data
    expect(mocks.updateDistilledMemory).not.toHaveBeenCalled();
  });

  it('should use STANDARD reasoning profile (not FAST) to avoid shallow gap closure signals', async () => {
    let capturedOptions: Record<string, unknown> = {};
    mocks.agentProcess.mockImplementation(
      (_userId: string, _prompt: string, options: Record<string, unknown>) => {
        capturedOptions = options;
        return Promise.resolve({
          responseText: JSON.stringify({
            facts: 'facts',
            lessons: [],
            gaps: [],
            resolvedGapIds: [],
          }),
        });
      }
    );

    const event = {
      detail: {
        userId: 'user-123',
        conversation: [{ role: MessageRole.USER, content: 'test' }],
      },
    };

    await handler(event as any, {} as any);

    expect(capturedOptions.profile).toBe('standard');
    expect(capturedOptions.profile).not.toBe('fast');
  });

  it('should use updateGapMetadata (not setGap) for deduplication to preserve existing status (Bug 3 regression)', async () => {
    // Simulate an existing gap in PLANNED state
    const existingGap = {
      id: 'GAP#1234567890',
      timestamp: 1234567890,
      content: 'Existing gap',
      metadata: { impact: 5, urgency: 3 },
    };

    // Mock getAgentContext to return memory with the existing gap
    vi.mocked((await import('../lib/utils/agent-helpers')).getAgentContext).mockResolvedValueOnce({
      memory: {
        getDistilledMemory: vi.fn().mockResolvedValue('Old facts'),
        getAllGaps: vi.fn().mockResolvedValue([existingGap]),
        updateDistilledMemory: mocks.updateDistilledMemory,
        addLesson: mocks.addLesson,
        setGap: mocks.setGap,
        updateGapStatus: mocks.updateGapStatus,
        updateGapMetadata: mocks.updateGapMetadata,
        getFailurePatterns: vi.fn().mockResolvedValue([]),
        getSummary: vi.fn().mockResolvedValue(null),
        updateSummary: vi.fn().mockResolvedValue(undefined),
      } as any,
      provider: { call: vi.fn() } as any,
    });

    const mockReflectionResponse = JSON.stringify({
      facts: 'facts',
      lessons: [],
      gaps: [],
      updatedGaps: [{ id: '1234567890', impact: 8, urgency: 7 }],
      resolvedGapIds: [],
    });

    mocks.agentProcess.mockResolvedValue({ responseText: mockReflectionResponse });

    const event = {
      detail: {
        userId: 'user-123',
        conversation: [{ role: MessageRole.USER, content: 'test' }],
      },
    };

    await handler(event as any, {} as any);

    // Should use updateGapMetadata (preserves status) NOT setGap (resets to OPEN)
    expect(mocks.updateGapMetadata).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ impact: 8, urgency: 7 })
    );
    expect(mocks.setGap).not.toHaveBeenCalled();
  });
});
