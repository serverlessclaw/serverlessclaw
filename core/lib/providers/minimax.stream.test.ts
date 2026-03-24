import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MiniMaxProvider } from './minimax';
import { ReasoningProfile, MessageRole } from '../types/index';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = {
        create: mockCreate,
      };
    },
  };
});

vi.mock('sst', () => ({
  Resource: {
    MiniMaxApiKey: { value: 'test-key' },
  },
}));

describe('MiniMaxProvider.stream', () => {
  let provider: MiniMaxProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new MiniMaxProvider();
  });

  it('should yield thought and text chunks from the MiniMax stream', async () => {
    async function* mockAsyncStream() {
      yield {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'Let me think' },
      };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
      yield { type: 'message_delta', usage: { output_tokens: 5 } };
    }

    mockCreate.mockResolvedValue(mockAsyncStream());

    const chunks = [];
    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'hi' }],
      [],
      ReasoningProfile.STANDARD
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(4);
    expect(chunks[0].thought).toBe('Let me think');
    expect(chunks[1].content).toBe('Hello');
    expect(chunks[2].content).toBe(' world');
    expect(chunks[3].usage?.completion_tokens).toBe(5);
  });

  it('should handle streaming tool calls', async () => {
    async function* mockAsyncStream() {
      yield {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'call_1', name: 'my_tool' },
      };
      yield {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"foo"' },
      };
      yield {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: ':"bar"}' },
      };
      yield { type: 'content_block_stop' };
    }

    mockCreate.mockResolvedValue(mockAsyncStream());

    const chunks = [];
    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'do it' }],
      [],
      ReasoningProfile.STANDARD
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // The current code yields on content_block_stop
    expect(chunks).toHaveLength(1);
    expect(chunks[0].tool_calls).toBeDefined();
    expect(chunks[0].tool_calls?.[0].function.name).toBe('my_tool');
    expect(chunks[0].tool_calls?.[0].function.arguments).toBe('{"foo":"bar"}');
  });

  it('should include output_config when responseFormat is provided', async () => {
    async function* mockAsyncStream() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"name":"John"}' } };
    }

    mockCreate.mockResolvedValue(mockAsyncStream());

    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: {
        name: 'person',
        strict: true,
        schema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
    };

    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'extract' }],
      [],
      ReasoningProfile.STANDARD,
      undefined,
      undefined,
      responseFormat
    );

    // Drain the stream
    for await (const _chunk of stream) {
      // drain
    }

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        output_config: {
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        },
      })
    );
  });
});
