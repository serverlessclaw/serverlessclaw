import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentExecutor } from './executor';
import { ReasoningProfile } from '../types/index';

vi.mock('../../handlers/events/cancellation-handler', () => ({
  isTaskCancelled: vi.fn().mockResolvedValue(false),
  handleTaskCancellation: vi.fn(),
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
    const stream = executor.streamLoop([], {
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 5,
      tracer: mockTracer as any,
      emitter: mockEmitter as any,
      traceId: 'trace-123',
      taskId: 'trace-123',
      nodeId: 'node-1',
      parentId: undefined,
      currentInitiator: 'superclaw',
      depth: 0,
      userId: 'user-1',
      userText: 'hello',
      mainConversationId: 'conv-1',
      sessionId: 'sess-1',
    });

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].content).toBe('Hello');
    expect(chunks[1].content).toBe(' world');
    expect(chunks[2].usage).toBeDefined();

    expect(mockEmitter.emitChunk).toHaveBeenCalledTimes(2);
    expect(mockEmitter.emitChunk).toHaveBeenCalledWith(
      'user-1',
      'sess-1',
      'trace-123',
      'Hello',
      'Test Agent',
      false
    );
    expect(mockEmitter.emitChunk).toHaveBeenCalledWith(
      'user-1',
      'sess-1',
      'trace-123',
      ' world',
      'Test Agent',
      false
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
    const stream = executor.streamLoop([], {
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 5,
      tracer: mockTracer as any,
      emitter: mockEmitter as any,
      traceId: 'trace-123',
      taskId: 'trace-123',
      nodeId: 'node-1',
      parentId: undefined,
      currentInitiator: 'superclaw',
      depth: 0,
      userId: 'user-1',
      userText: 'call tool',
      mainConversationId: 'conv-1',
    });

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // First iteration: content + tool_calls
    expect(chunks[0].content).toBe('I will call a tool.');
    expect(chunks[1].tool_calls).toHaveLength(1);

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
    const stream = executor.streamLoop([], {
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 5,
      tracer: mockTracer as any,
      emitter: mockEmitter as any,
      traceId: 'trace-mm',
      taskId: 'trace-mm',
      nodeId: 'node-1',
      parentId: undefined,
      currentInitiator: 'superclaw',
      depth: 0,
      userId: 'user-1',
      userText: 'remember who i am?',
      mainConversationId: 'conv-1',
      sessionId: 'sess-mm',
    });

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
    const stream = executor.streamLoop([], {
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 5,
      tracer: mockTracer as any,
      emitter: mockEmitter as any,
      traceId: 'trace-cmb',
      taskId: 'trace-cmb',
      nodeId: 'node-1',
      parentId: undefined,
      currentInitiator: 'superclaw',
      depth: 0,
      userId: 'user-1',
      userText: 'search for test',
      mainConversationId: 'conv-1',
      sessionId: 'sess-cmb',
    });

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
    const stream = executor.streamLoop([], {
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 5,
      tracer: mockTracer as any,
      emitter: mockEmitter as any,
      traceId: 'trace-txt',
      taskId: 'trace-txt',
      nodeId: 'node-1',
      parentId: undefined,
      currentInitiator: 'superclaw',
      depth: 0,
      userId: 'user-1',
      userText: 'hello',
      mainConversationId: 'conv-1',
      sessionId: 'sess-txt',
    });

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Only the content chunk, no tool_calls chunk
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Hello there!');
    expect(chunks[0].tool_calls).toBeUndefined();
  });
});
