import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentExecutor } from './executor';
import { ReasoningProfile } from '../types/index';

vi.mock('../../handlers/events/cancellation-handler', () => ({
  isTaskCancelled: vi.fn().mockResolvedValue(false),
  handleTaskCancellation: vi.fn(),
}));

const { MockSafetyEngine } = vi.hoisted(() => {
  return {
    MockSafetyEngine: class {
      evaluateAction = vi.fn().mockResolvedValue({
        allowed: true,
        requiresApproval: false,
        reason: 'Authorized',
      });
      getClassCBlastRadius = vi.fn().mockReturnValue({});
    },
  };
});

vi.mock('../safety/safety-engine', () => ({
  SafetyEngine: MockSafetyEngine,
  getSafetyEngine: () => new MockSafetyEngine(),
}));

describe('AgentExecutor.streamLoop', () => {
  let mockProvider: any;
  let mockTracer: any;
  let mockEmitter: any;

  beforeEach(() => {
    mockProvider = {
      call: vi.fn(),
      stream: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: [ReasoningProfile.STANDARD],
        supportsStructuredOutput: true,
      }),
    };

    mockTracer = {
      addStep: vi.fn().mockResolvedValue(undefined),
    };

    mockEmitter = {
      emitChunk: vi.fn().mockResolvedValue(undefined),
    };
  });

  const getDefaultOptions = (overrides: Record<string, any> = {}) => ({
    activeModel: 'gpt-4o',
    activeProvider: 'openai',
    activeProfile: ReasoningProfile.STANDARD,
    maxIterations: 5,
    tracer: mockTracer as any,
    traceId: 'trace-123',
    taskId: 'task-123',
    nodeId: 'node-1',
    currentInitiator: 'superclaw',
    depth: 0,
    userId: 'user-1',
    userText: 'test task',
    mainConversationId: 'conv-1',
    ...overrides,
  });

  it('should yield chunks and emit them via emitter', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'test-agent', 'Test Agent');

    // Mock an async generator for the provider stream
    async function* mockStream() {
      yield { content: 'Hello' };
      yield { content: ' world' };
      yield { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    }
    mockProvider.stream.mockReturnValue(mockStream());

    const chunks = [];
    const stream = executor.streamLoop(
      [],
      getDefaultOptions({
        emitter: mockEmitter as any,
        sessionId: 'sess-1',
      })
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(5);
    expect(chunks[0].messageId).toBe('trace-123-test-agent');
    expect(chunks[1].content).toBe('Hello');
    expect(chunks[2].content).toBe(' world');
    expect(chunks[3].usage).toBeDefined();
    expect(chunks[4].usage).toBeDefined();

    expect(mockEmitter.emitChunk).toHaveBeenCalledTimes(4);
    expect(mockEmitter.emitChunk).toHaveBeenCalledWith(
      'user-1',
      'sess-1',
      'trace-123',
      expect.objectContaining({
        chunk: 'Hello',
        agentName: 'Test Agent',
        isThought: false,
        initiatorId: 'superclaw',
        detailType: 'TEXT_MESSAGE_CONTENT',
        model: 'gpt-4o',
      })
    );
    expect(mockEmitter.emitChunk).toHaveBeenCalledWith(
      'user-1',
      'sess-1',
      'trace-123',
      expect.objectContaining({
        chunk: 'Hello world',
        agentName: 'Test Agent',
        detailType: 'outbound_message',
        model: 'gpt-4o',
      })
    );
  });

  it('should execute tool calls and continue the loop to get final response', async () => {
    const mockToolExecute = vi.fn().mockResolvedValue('tool result');
    const tools = [
      {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {},
        execute: mockToolExecute,
      },
    ];
    const executor = new AgentExecutor(
      mockProvider as any,
      tools as any,
      'test-agent',
      'Test Agent'
    );

    // First call: returns text + tool_calls
    // Second call (after tool execution): returns final text
    let callCount = 0;
    async function* mockStreamFactory() {
      callCount++;
      if (callCount === 1) {
        yield { content: 'I will call a tool.' };
        yield {
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'test_tool', arguments: '{}' },
            },
          ],
        };
      } else {
        yield { content: 'Tool result: done!' };
      }
    }
    mockProvider.stream.mockImplementation(() => mockStreamFactory());

    const chunks = [];
    const stream = executor.streamLoop(
      [],
      getDefaultOptions({
        emitter: mockEmitter as any,
      })
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Initial metadata chunk
    expect(chunks[0].messageId).toBe('trace-123-test-agent');

    // First iteration: content + tool_calls
    expect(chunks[1].content).toBe('I will call a tool.');
    expect(chunks[2].tool_calls).toHaveLength(1);

    // Tool was executed
    expect(mockToolExecute).toHaveBeenCalledTimes(1);

    // Second iteration: final response after tool execution
    const finalContent = chunks.filter((c) => c.content);
    expect(finalContent[finalContent.length - 1].content).toBe('Tool result: done!');

    // Provider was called twice (once for tool detection, once for final response)
    expect(callCount).toBe(2);
  });

  it('should yield tool_calls when provider returns only tool_calls with no content (MiniMax scenario)', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'test-agent', 'Test Agent');

    // MiniMax fake-stream: single chunk with tool_calls but empty content
    async function* mockMiniMaxStream() {
      yield {
        content: '',
        tool_calls: [
          {
            id: 'call-mm-1',
            type: 'function',
            function: { name: 'recallKnowledge', arguments: '{"query":"user identity"}' },
          },
        ],
      };
    }
    mockProvider.stream.mockReturnValue(mockMiniMaxStream());

    const chunks = [];
    const stream = executor.streamLoop(
      [],
      getDefaultOptions({
        emitter: mockEmitter as any,
        traceId: 'trace-mm',
        taskId: 'trace-mm',
        sessionId: 'sess-mm',
      })
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Should yield the tool_calls chunk even with empty content
    const toolCallChunks = chunks.filter((c) => c.tool_calls);
    expect(toolCallChunks).toHaveLength(1);
    expect(toolCallChunks[0].tool_calls![0].function.name).toBe('recallKnowledge');
  });

  it('should yield tool_calls when provider returns content and tool_calls in same chunk', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'test-agent', 'Test Agent');

    // Provider returns both content and tool_calls in one chunk
    async function* mockCombinedStream() {
      yield {
        content: 'Let me look that up.',
        tool_calls: [
          {
            id: 'call-cmb-1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"test"}' },
          },
        ],
      };
    }
    mockProvider.stream.mockReturnValue(mockCombinedStream());

    const chunks = [];
    const stream = executor.streamLoop(
      [],
      getDefaultOptions({
        emitter: mockEmitter as any,
        traceId: 'trace-cmb',
        taskId: 'trace-cmb',
        sessionId: 'sess-cmb',
      })
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Content chunk yielded (with tool_calls from provider) + explicit tool_calls yield
    expect(chunks.filter((c) => c.content)).toHaveLength(1);
    expect(chunks.find((c) => c.content)!.content).toBe('Let me look that up.');
    // At least one chunk has tool_calls (the explicit yield ensures route captures them)
    const tcChunks = chunks.filter((c) => c.tool_calls);
    expect(tcChunks.length).toBeGreaterThanOrEqual(1);
    expect(tcChunks.some((c) => c.tool_calls![0].id === 'call-cmb-1')).toBe(true);
  });

  it('should NOT yield extra tool_calls chunk when no tool calls are present', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'test-agent', 'Test Agent');

    async function* mockTextOnlyStream() {
      yield { content: 'Hello there!' };
    }
    mockProvider.stream.mockReturnValue(mockTextOnlyStream());

    const chunks = [];
    const stream = executor.streamLoop(
      [],
      getDefaultOptions({
        emitter: mockEmitter as any,
        traceId: 'trace-txt',
        taskId: 'trace-txt',
        sessionId: 'sess-txt',
      })
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Metadata + Content + Final Usage
    expect(chunks).toHaveLength(3);
    expect(mockEmitter.emitChunk).toHaveBeenCalledWith(
      'user-1',
      'sess-txt',
      'trace-txt',
      expect.objectContaining({
        chunk: 'Hello there!',
        agentName: 'Test Agent',
        detailType: 'outbound_message',
        model: 'gpt-4o',
      })
    );
    expect(chunks[1].tool_calls).toBeUndefined();
  });

  it('should propagate workspaceId scope to all emission calls', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'test-agent', 'Test Agent');

    async function* mockStream() {
      yield { content: 'Scoped' };
    }
    mockProvider.stream.mockReturnValue(mockStream());

    const stream = executor.streamLoop(
      [],
      getDefaultOptions({
        emitter: mockEmitter as any,
        sessionId: 'sess-1',
        workspaceId: 'default',
      })
    );

    for await (const _ of stream) {
      // consume stream for test
    }

    expect(mockEmitter.emitChunk).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        detailType: 'TEXT_MESSAGE_START',
        scope: { workspaceId: 'default', teamId: undefined, staffId: undefined },
      })
    );
  });
});
