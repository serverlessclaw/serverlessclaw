import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from './agent';
import {
  IMemory,
  IProvider,
  MessageRole,
  TraceSource,
  AttachmentType,
  ReasoningProfile,
  AgentCategory,
  MessageChunk,
  EventType,
} from './types/index';

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
    failTrace = vi.fn().mockResolvedValue(undefined);
    detectDrift = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('./agent/context-manager', () => ({
  ContextManager: {
    getManagedContext: vi.fn().mockImplementation((_history, _summary, contextPrompt, _limit) => ({
      messages: [
        {
          role: MessageRole.SYSTEM,
          content: contextPrompt,
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
        { role: MessageRole.USER, content: 'Hello', traceId: 'test-trace', messageId: 'test-msg' },
      ],
    })),
    needsSummarization: vi.fn().mockResolvedValue(false),
    summarize: vi.fn().mockResolvedValue(undefined),
    estimateTokens: vi.fn().mockReturnValue(100),
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

// Mock recursion-tracker to avoid budget issues
vi.mock('./recursion-tracker', () => ({
  isBudgetExceeded: vi.fn().mockResolvedValue(false),
}));

// Mock handoff to avoid being blocked
vi.mock('./handoff', () => ({
  isHumanTakingControl: vi.fn().mockResolvedValue(false),
}));

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('Agent Reasoning & Streaming Coverage', () => {
  let mockMemory: IMemory;
  let mockProvider: IProvider;
  let mockEmitter: { emitChunk: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockMemory = {
      getHistory: vi.fn().mockResolvedValue([]),
      getDistilledMemory: vi.fn().mockResolvedValue(''),
      getLessons: vi.fn().mockResolvedValue([]),
      getGlobalLessons: vi.fn().mockResolvedValue([]),
      addMessage: vi.fn().mockResolvedValue(undefined),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      updateGapStatus: vi.fn().mockResolvedValue(undefined),
      getSummary: vi.fn().mockResolvedValue(null),
      updateSummary: vi.fn().mockResolvedValue(undefined),
    } as unknown as IMemory;

    mockProvider = {
      stream: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: [ReasoningProfile.STANDARD, ReasoningProfile.THINKING],
        supportedAttachmentTypes: [AttachmentType.IMAGE, AttachmentType.FILE],
      }),
      call: vi.fn(),
    } as unknown as IProvider;

    mockEmitter = {
      emitChunk: vi.fn().mockResolvedValue(undefined),
    };

    mockGetTraceId.mockReturnValue('reasoning-trace-id');
    mockGetNodeId.mockReturnValue('root');
    mockGetParentId.mockReturnValue(undefined);
    mockStartTrace.mockResolvedValue('reasoning-trace-id');
    mockEndTrace.mockResolvedValue(undefined);
  });

  const createTestAgent = () => {
    const agent = new Agent(mockMemory, mockProvider, [], 'System prompt', {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'System prompt',
      description: 'test-agent',
      category: AgentCategory.SYSTEM,
      icon: 'test',
      tools: [],
    });
    // Inject mock emitter
    (agent as any).emitter = mockEmitter;
    return agent;
  };

  it('TC1: should emit prefaced thinking indicator for THINKING profile', async () => {
    const agent = createTestAgent();
    async function* mockStream() {
      yield { content: 'Actual response' };
    }
    vi.mocked(mockProvider.stream).mockReturnValue(mockStream());

    const chunks: MessageChunk[] = [];
    for await (const chunk of agent.stream('user-1', 'Hello', {
      profile: ReasoningProfile.THINKING,
    })) {
      chunks.push(chunk);
    }

    // Verify that the emitter was called with thinking=true and the ellipsis marker
    expect(mockEmitter.emitChunk).toHaveBeenCalledWith(
      expect.any(String), // userId
      undefined, // sessionId
      expect.any(String), // traceId
      undefined, // content
      'Test Agent', // agentName
      true, // thinking
      undefined, // options
      'test-agent', // initiator
      '\u2026', // thought (ellipsis)
      undefined,
      undefined,
      EventType.TEXT_MESSAGE_CONTENT
    );
  });

  it('TC2: should correctly aggregate interleaved thought and content chunks', async () => {
    const agent = createTestAgent();
    async function* mockStream() {
      yield { thought: 'I am' };
      yield { thought: ' thinking' };
      yield { content: 'Hello' };
      yield { content: ' world' };
    }
    vi.mocked(mockProvider.stream).mockReturnValue(mockStream());

    const chunks: MessageChunk[] = [];
    for await (const chunk of agent.stream('user-1', 'Hello', {})) {
      chunks.push(chunk);
    }

    // Verify aggregated thought and content in memory save
    const addMessageCalls = vi.mocked(mockMemory.addMessage).mock.calls;
    const assistantCall = addMessageCalls.find((call) => call[1].role === MessageRole.ASSISTANT);

    expect(assistantCall).toBeDefined();
    expect(assistantCall![1]).toMatchObject({
      content: 'Hello world',
      thought: 'I am thinking',
    });
  });

  it('TC3: should extract thought from JSON content in communicationMode: json', async () => {
    const agent = createTestAgent();
    agent.config!.defaultCommunicationMode = 'json' as any;

    async function* mockStream() {
      yield { content: '{"thought":' };
      yield { content: ' "I am thinking", "message": "Hello"}' };
    }
    vi.mocked(mockProvider.stream).mockReturnValue(mockStream());

    const chunks: MessageChunk[] = [];
    for await (const chunk of agent.stream('user-1', 'Hello', {
      communicationMode: 'json' as any,
    })) {
      chunks.push(chunk);
    }

    // Verify that incremental extraction worked (at least one chunk should have detected thought)
    const thoughtChunks = chunks.filter((c) => c.thought === 'I am thinking');
    expect(thoughtChunks.length).toBeGreaterThan(0);

    // Verify final memory save parsed the JSON
    const addMessageCalls = vi.mocked(mockMemory.addMessage).mock.calls;
    const assistantCall = addMessageCalls.find((call) => call[1].role === MessageRole.ASSISTANT);

    expect(assistantCall![1]).toMatchObject({
      content: 'Hello',
      thought: 'I am thinking',
    });
  });

  it('TC4: should fallback to process() if stream is empty', async () => {
    const agent = createTestAgent();

    // Mock empty stream
    async function* emptyStream() {}
    vi.mocked(mockProvider.stream).mockReturnValue(emptyStream());

    // Mock non-streaming process call
    const processSpy = vi.spyOn(agent, 'process').mockResolvedValue({
      responseText: 'Fallback response',
      thought: 'Fallback thought',
      traceId: 'fallback-trace',
    });

    const chunks: MessageChunk[] = [];
    for await (const chunk of agent.stream('user-1', 'Hello', {})) {
      chunks.push(chunk);
    }

    expect(processSpy).toHaveBeenCalled();
    expect(chunks).toContainEqual(
      expect.objectContaining({
        content: 'Fallback response',
        thought: 'Fallback thought',
      })
    );
  });
});
