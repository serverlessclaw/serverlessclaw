import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BedrockProvider } from './bedrock';
import { ReasoningProfile, MessageRole } from '../types/index';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  return {
    BedrockRuntimeClient: vi.fn().mockImplementation(function () {
      return { send: mockSend };
    }),
    ConverseStreamCommand: vi.fn().mockImplementation(function (args) {
      return args;
    }),
  };
});

vi.mock('sst', () => ({
  Resource: {
    AwsRegion: { value: 'us-east-1' },
  },
}));

describe('BedrockProvider.stream', () => {
  let provider: BedrockProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new BedrockProvider('claude-sonnet-4-6');
  });

  it('should yield text and thought chunks from the stream', async () => {
    async function* mockStream() {
      yield {
        contentBlockDelta: {
          delta: { text: 'Hello' },
          contentBlockIndex: 0,
        },
      };
      yield {
        contentBlockDelta: {
          delta: { reasoningContent: { text: 'Let me think' } },
          contentBlockIndex: 1,
        },
      };
      yield {
        contentBlockDelta: {
          delta: { text: ' world' },
          contentBlockIndex: 0,
        },
      };
      yield {
        metadata: {
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      };
    }

    mockSend.mockResolvedValue({ stream: mockStream() });

    const chunks = [];
    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'hi', traceId: 'test-trace', messageId: 'test-msg' }],
      [],
      ReasoningProfile.STANDARD
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(4);
    expect(chunks[0].content).toBe('Hello');
    expect(chunks[1].thought).toBe('Let me think');
    expect(chunks[2].content).toBe(' world');
    expect(chunks[3].usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it('should handle streaming tool calls', async () => {
    async function* mockStream() {
      yield {
        contentBlockStart: {
          start: { toolUse: { toolUseId: 'call_1', name: 'my_tool' } },
          contentBlockIndex: 0,
        },
      };
      yield {
        contentBlockDelta: {
          delta: { toolUse: { input: '{"foo":' } },
          contentBlockIndex: 0,
        },
      };
      yield {
        contentBlockDelta: {
          delta: { toolUse: { input: '"bar"}' } },
          contentBlockIndex: 0,
        },
      };
      yield {
        contentBlockStop: { contentBlockIndex: 0 },
      };
    }

    mockSend.mockResolvedValue({ stream: mockStream() });

    const chunks = [];
    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'do it', traceId: 'test-trace', messageId: 'test-msg' }],
      [],
      ReasoningProfile.STANDARD
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const toolCallChunks = chunks.filter((c) => c.tool_calls);
    expect(toolCallChunks).toHaveLength(1);
    expect(toolCallChunks[0].tool_calls?.[0].function.name).toBe('my_tool');
    expect(toolCallChunks[0].tool_calls?.[0].function.arguments).toBe('{"foo":"bar"}');
  });

  it('should apply thinking budgets for DEEP profile in stream', async () => {
    async function* mockStream() {
      yield { contentBlockDelta: { delta: { text: 'OK' }, contentBlockIndex: 0 } };
    }

    mockSend.mockResolvedValue({ stream: mockStream() });

    const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime');

    const chunks = [];
    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      [],
      ReasoningProfile.DEEP
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(ConverseStreamCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalModelRequestFields: expect.objectContaining({
          thinking: { type: 'enabled', budget_tokens: 8192 },
        }),
      })
    );
  });

  it('should throw on stream error to enable fallback', async () => {
    mockSend.mockRejectedValue(new Error('Network error'));

    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      [],
      ReasoningProfile.STANDARD
    );

    await expect(async () => {
      for await (const _chunk of stream) {
        // consume
      }
    }).rejects.toThrow('Bedrock streaming failed: Network error');
  });
});
