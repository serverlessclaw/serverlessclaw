import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from './agent';
import { IMemory, IProvider, MessageRole, TraceSource, MessageChunk } from './types/index';

// ── Mocks ───────────────────────────────────────────────────────────────────────

const mockGetTraceId = vi.fn();
const mockGetNodeId = vi.fn();
const mockGetParentId = vi.fn();
const mockStartTrace = vi.fn();
const mockEndTrace = vi.fn();

vi.mock('./tracer', () => ({
  ClawTracer: class {
    constructor(
      public userId: string,
      public source: TraceSource | string,
      public traceId: string,
      public nodeId: string,
      public parentId: string
    ) {}
    getTraceId = mockGetTraceId;
    getNodeId = mockGetNodeId;
    getParentId = mockGetParentId;
    startTrace = mockStartTrace;
    addStep = vi.fn().mockResolvedValue(undefined);
    endTrace = mockEndTrace;
  },
}));

vi.mock('./agent/context-manager', () => ({
  ContextManager: {
    getManagedContext: vi.fn().mockImplementation((_history, _summary, contextPrompt, _limit) => ({
      messages: [
        { role: MessageRole.SYSTEM, content: contextPrompt },
        { role: MessageRole.USER, content: 'Hello' },
      ],
    })),
  },
}));

vi.mock('./agent/context', () => ({
  AgentContext: {
    getMemoryIndexBlock: vi.fn().mockReturnValue('[MEMORY_INDEX]'),
    getIdentityBlock: vi.fn().mockReturnValue('[IDENTITY]'),
  },
}));

vi.mock('./registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    getTypedConfig: vi.fn(),
  },
}));

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('Agent.stream()', () => {
  let mockMemory: IMemory;
  let mockProvider: IProvider;
  let mockEmitter: { emitChunk: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockMemory = {
      getHistory: vi.fn().mockResolvedValue([]),
      getDistilledMemory: vi.fn().mockResolvedValue(''),
      getLessons: vi.fn().mockResolvedValue([]),
      addMessage: vi.fn().mockResolvedValue(undefined),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      updateGapStatus: vi.fn().mockResolvedValue(undefined),
      getSummary: vi.fn().mockResolvedValue(null),
      updateSummary: vi.fn().mockResolvedValue(undefined),
    } as unknown as IMemory;

    mockProvider = {
      call: vi.fn(),
      stream: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: ['standard'],
        supportsStructuredOutput: false,
        contextWindow: 128000,
      }),
    } as unknown as IProvider;

    mockEmitter = {
      emitChunk: vi.fn().mockResolvedValue(undefined),
    };

    mockGetTraceId.mockReturnValue('stream-trace-id');
    mockGetNodeId.mockReturnValue('root');
    mockGetParentId.mockReturnValue(undefined);
    mockStartTrace.mockResolvedValue('stream-trace-id');
    mockEndTrace.mockResolvedValue(undefined);
  });

  it('should save the user message to memory before streaming', async () => {
    async function* mockStream() {
      yield { content: 'Hello' };
      yield { content: ' world' };
    }
    (mockProvider.stream as ReturnType<typeof vi.fn>).mockReturnValue(mockStream());

    const agent = new Agent(mockMemory, mockProvider, [], 'System prompt', {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'System prompt',
    });

    // Consume the stream
    const chunks: MessageChunk[] = [];
    for await (const chunk of agent.stream('user-1', 'Hello', {
      source: TraceSource.DASHBOARD,
    })) {
      chunks.push(chunk);
    }

    // User message MUST be saved before getHistory is called
    const addMessageCalls = vi.mocked(mockMemory.addMessage).mock.calls;

    expect(addMessageCalls.length).toBeGreaterThanOrEqual(1);
    expect(addMessageCalls[0][0]).toBe('user-1');
    expect(addMessageCalls[0][1]).toMatchObject({
      role: MessageRole.USER,
      content: 'Hello',
    });

    // addMessage(user) must be called BEFORE getHistory
    const addUserMessageOrder = vi.mocked(mockMemory.addMessage).mock.invocationCallOrder[0];
    const getHistoryOrder = vi.mocked(mockMemory.getHistory).mock.invocationCallOrder[0];
    expect(addUserMessageOrder).toBeLessThan(getHistoryOrder);
  });

  it('should save user message with attachments', async () => {
    async function* mockStream() {
      yield { content: 'I see it' };
    }
    (mockProvider.stream as ReturnType<typeof vi.fn>).mockReturnValue(mockStream());

    const attachments = [{ type: 'image' as const, base64: 'abc123', name: 'photo.png' }];

    const agent = new Agent(mockMemory, mockProvider, [], 'System', {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'System',
    });

    const chunks: MessageChunk[] = [];
    for await (const chunk of agent.stream('user-1', 'What is this?', {
      attachments,
    })) {
      chunks.push(chunk);
    }

    expect(mockMemory.addMessage).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        role: MessageRole.USER,
        content: 'What is this?',
        attachments,
      })
    );
  });

  it('should save the final assistant message to memory after stream completes', async () => {
    async function* mockStream() {
      yield { content: 'Hello' };
      yield { content: ' world' };
    }
    (mockProvider.stream as ReturnType<typeof vi.fn>).mockReturnValue(mockStream());

    const agent = new Agent(mockMemory, mockProvider, [], 'System', {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'System',
    });

    const chunks: MessageChunk[] = [];
    for await (const chunk of agent.stream('user-1', 'Hi', {})) {
      chunks.push(chunk);
    }

    // The LAST addMessage call should be the assistant response
    const addMessageCalls = vi.mocked(mockMemory.addMessage).mock.calls;
    const lastCall = addMessageCalls[addMessageCalls.length - 1];

    expect(lastCall[0]).toBe('user-1');
    expect(lastCall[1]).toMatchObject({
      role: MessageRole.ASSISTANT,
      content: 'Hello world',
      agentName: 'Test Agent',
      traceId: 'stream-trace-id',
    });
  });

  it('should yield chunks from the provider stream', async () => {
    async function* mockStream() {
      yield { content: 'Part1' };
      yield { content: 'Part2' };
      yield { content: 'Part3' };
    }
    (mockProvider.stream as ReturnType<typeof vi.fn>).mockReturnValue(mockStream());

    const agent = new Agent(mockMemory, mockProvider, [], 'System', {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'System',
    });

    const chunks: MessageChunk[] = [];
    for await (const chunk of agent.stream('user-1', 'Go', {})) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(5);
    expect(chunks[0].agentName).toBe('Test');
    expect(chunks[1].content).toBe('Part1');
    expect(chunks[2].content).toBe('Part2');
    expect(chunks[3].content).toBe('Part3');
    expect(chunks[4].usage).toBeDefined();
  });

  it('should use provided traceId via emitter for chunk identification', async () => {
    async function* mockStream() {
      yield { content: 'Streamed response' };
    }
    (mockProvider.stream as ReturnType<typeof vi.fn>).mockReturnValue(mockStream());

    mockGetTraceId.mockReturnValue('client-trace-123');

    const agent = new Agent(mockMemory, mockProvider, [], 'System', {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'System',
    });
    (agent as any).emitter = mockEmitter;

    const chunks: MessageChunk[] = [];
    for await (const chunk of agent.stream('user-1', 'Stream this', {
      traceId: 'client-trace-123',
      sessionId: 'sess-1',
      source: TraceSource.DASHBOARD,
    })) {
      chunks.push(chunk);
    }

    // Emitter should be called with the client-provided traceId as messageId
    expect(mockEmitter.emitChunk).toHaveBeenCalledWith(
      'user-1',
      'sess-1',
      'client-trace-123',
      'Streamed response',
      'Test Agent',
      false
    );

    // Assistant message should use the same traceId
    const addMessageCalls = vi.mocked(mockMemory.addMessage).mock.calls;
    const assistantCall = addMessageCalls[addMessageCalls.length - 1];
    expect(assistantCall[1]).toMatchObject({ traceId: 'client-trace-123' });
  });

  it('should use userId as storageId for non-isolated streams', async () => {
    async function* mockStream() {
      yield { content: 'OK' };
    }
    (mockProvider.stream as ReturnType<typeof vi.fn>).mockReturnValue(mockStream());

    const agent = new Agent(mockMemory, mockProvider, [], 'System', {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'System',
    });

    for await (const _ of agent.stream('CONV#dashboard-user#sess-1', 'Hi', {})) {
      // consume
    }

    // storageId should remain 'CONV#dashboard-user#sess-1' (non-isolated uses userId directly)
    expect(mockMemory.addMessage).toHaveBeenCalledWith(
      'CONV#dashboard-user#sess-1',
      expect.objectContaining({ role: MessageRole.USER })
    );
    expect(mockMemory.getHistory).toHaveBeenCalledWith('CONV#dashboard-user#sess-1');
  });
});
