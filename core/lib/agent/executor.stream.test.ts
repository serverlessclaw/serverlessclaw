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

  it('should handle tool calls by breaking the stream loop', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'test-agent', 'Test Agent');

    async function* mockStreamWithTools() {
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
    }
    mockProvider.stream.mockReturnValue(mockStreamWithTools());

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

    // It should yield the content chunk AND the tool_calls chunk before breaking
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('I will call a tool.');
    expect(chunks[1].tool_calls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'test_tool', arguments: '{}' },
      },
    ]);
    expect(mockEmitter.emitChunk).toHaveBeenCalledWith(
      'user-1',
      undefined,
      'trace-123',
      'I will call a tool.',
      'Test Agent',
      false
    );
  });
});
