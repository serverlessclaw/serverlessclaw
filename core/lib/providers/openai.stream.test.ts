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
});
