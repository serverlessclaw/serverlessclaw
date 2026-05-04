import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai';
import { ReasoningProfile } from '../types/index';
import { Resource } from 'sst';

const mockCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: class {
      responses = {
        create: mockCreate,
      };
    },
  };
});

vi.mock('sst', () => ({
  Resource: {
    OpenAIApiKey: { value: 'sk-stream-test-key' },
  },
}));

describe('OpenAIProvider.stream', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.SST_SECRET_OpenAIApiKey;
    (Resource as unknown as { OpenAIApiKey?: { value?: string } }).OpenAIApiKey = {
      value: 'sk-stream-test-key',
    };
    (OpenAIProvider as unknown as { _client: unknown; _currentKey: string | null })._client = null;
    (OpenAIProvider as unknown as { _client: unknown; _currentKey: string | null })._currentKey =
      null;
    provider = new OpenAIProvider();
  });

  it('should fail fast with configuration error when all API keys are placeholders', async () => {
    (Resource as unknown as { OpenAIApiKey?: { value?: string } }).OpenAIApiKey = {
      value: 'dummy',
    };
    process.env.OPENAI_API_KEY = 'test';
    process.env.SST_SECRET_OpenAIApiKey = 'test-key';

    const consumeStream = async () => {
      const stream = provider.stream(
        [{ role: 'user' as any, content: 'hi', traceId: 't1', messageId: 'm1' }],
        [],
        ReasoningProfile.STANDARD
      );

      for await (const _chunk of stream) {
        // no-op
      }
    };

    await expect(consumeStream()).rejects.toThrow(
      'OpenAI API key is not configured. Set SST_SECRET_OpenAIApiKey (preferred for make dev) or OPENAI_API_KEY.'
    );
  });

  it('should yield chunks from the OpenAI stream', async () => {
    // Mock the async generator returned by OpenAI
    async function* mockAsyncStream() {
      yield { type: 'text.delta', delta: 'Hello' };
      yield { type: 'text.delta', delta: ' world' };
      yield { type: 'usage', usage: { prompt_tokens: 5, completion_tokens: 2 } };
    }

    mockCreate.mockResolvedValue(mockAsyncStream());

    const chunks = [];
    const stream = provider.stream(
      [{ role: 'user' as any, content: 'hi', traceId: 't1', messageId: 'm1' }],
      [],
      ReasoningProfile.STANDARD
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].content).toBe('Hello');
    expect(chunks[1].content).toBe(' world');
    expect(chunks[2].usage?.prompt_tokens).toBe(5);
  });

  it('should handle different delta types in the stream', async () => {
    async function* mockAsyncStream() {
      yield { type: 'output_text.delta', delta: 'Foo' };
      yield { type: 'message.delta', delta: { content: 'Bar' } };
    }

    mockCreate.mockResolvedValue(mockAsyncStream());

    const chunks = [];
    const stream = provider.stream(
      [{ role: 'user' as any, content: 'hi', traceId: 't1', messageId: 'm1' }],
      [],
      ReasoningProfile.STANDARD
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('Foo');
    expect(chunks[1].content).toBe('Bar');
  });

  it('should yield tool call chunks when output_item.done for function_call is emitted', async () => {
    async function* mockAsyncStream() {
      yield {
        type: 'output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call_123',
          name: 'listAgents',
          arguments: '{}',
        },
      };
    }

    mockCreate.mockResolvedValue(mockAsyncStream());

    const chunks = [];
    const stream = provider.stream(
      [{ role: 'user' as any, content: 'hi', traceId: 't1', messageId: 'm1' }],
      [
        {
          name: 'listAgents',
          description: 'Lists all agents',
          parameters: { type: 'object' },
        } as any,
      ],
      ReasoningProfile.STANDARD
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].tool_calls).toBeDefined();
    expect(chunks[0].tool_calls![0].function.name).toBe('listAgents');
    expect(chunks[0].tool_calls![0].id).toBe('call_123');
  });

  it('should handle response.reasoning_summary_text.delta from GPT-5', async () => {
    async function* mockAsyncStream() {
      yield { type: 'response.reasoning_summary_text.delta', delta: 'Thinking about' };
      yield { type: 'response.reasoning_summary_text.delta', delta: ' the answer' };
      yield { type: 'response.output_text.delta', delta: 'Final answer' };
    }

    mockCreate.mockResolvedValue(mockAsyncStream());

    const chunks = [];
    const stream = provider.stream(
      [{ role: 'user' as any, content: 'hi', traceId: 't1', messageId: 'm1' }],
      [],
      ReasoningProfile.THINKING
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].thought).toBe('Thinking about');
    expect(chunks[1].thought).toBe(' the answer');
    expect(chunks[2].content).toBe('Final answer');
  });
});
