import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai';
import { ReasoningProfile } from '../types/index';

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
    OpenAIApiKey: { value: 'test-key' },
  },
}));

describe('OpenAIProvider.stream', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider();
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
