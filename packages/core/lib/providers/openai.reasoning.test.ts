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
    App: { name: 'test-app', stage: 'test-stage' },
  },
}));

describe('OpenAIProvider.stream reasoning and prefixed events', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.SST_SECRET_OpenAIApiKey;
    (Resource as any).OpenAIApiKey = { value: 'sk-stream-test-key' };
    (OpenAIProvider as any)._client = null;
    (OpenAIProvider as any)._currentKey = null;
    provider = new OpenAIProvider();
  });

  it('should yield content chunks with response. prefixes', async () => {
    async function* mockAsyncStream() {
      yield { type: 'response.text.delta', delta: 'Hello' };
      yield { type: 'response.output_text.delta', delta: { value: ' World' } };
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
    expect(chunks[0].content).toBe('Hello');
    expect(chunks[1].content).toBe(' World');
  });

  it('should yield thought chunks from various reasoning event types', async () => {
    async function* mockAsyncStream() {
      yield { type: 'reasoning.delta', delta: 'I am' };
      yield { type: 'response.reasoning.delta', delta: { value: ' thinking' } };
      yield { type: 'output_thought.delta', delta: ' about' };
      yield { type: 'response.output_thought.delta', delta: { text: ' stuff' } };
      yield { type: 'thought.delta', delta: '...' };
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

    expect(chunks).toHaveLength(5);
    expect(chunks[0].thought).toBe('I am');
    expect(chunks[1].thought).toBe(' thinking');
    expect(chunks[2].thought).toBe(' about');
    expect(chunks[3].thought).toBe(' stuff');
    expect(chunks[4].thought).toBe('...');
  });

  it('should support reasoning_content field in deltas (o1/o3 style)', async () => {
    async function* mockAsyncStream() {
      yield { type: 'message.delta', delta: { reasoning_content: 'Hidden thought' } };
      yield { type: 'response.message.delta', delta: { content: 'Visible text' } };
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
    expect(chunks[0].thought).toBe('Hidden thought');
    expect(chunks[1].content).toBe('Visible text');
  });

  it('should extract deltas from nested item structure', async () => {
    async function* mockAsyncStream() {
      yield { type: 'response.output_text.delta', item: { delta: { value: 'Nested' } } };
      yield { type: 'response.reasoning.delta', item: { delta: 'Thought' } };
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
    expect(chunks[0].content).toBe('Nested');
    expect(chunks[1].thought).toBe('Thought');
  });

  it('should handle usage events with response. prefix', async () => {
    async function* mockAsyncStream() {
      yield {
        type: 'response.usage',
        response: {
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        },
      };
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

    expect(chunks).toHaveLength(1);
    expect(chunks[0].usage?.prompt_tokens).toBe(10);
    expect(chunks[0].usage?.completion_tokens).toBe(20);
  });

  it('should request reasoning.summary=auto for GPT-5 thinking profile', async () => {
    async function* mockAsyncStream() {
      yield { type: 'response.output_text.delta', delta: 'ok' };
    }

    mockCreate.mockResolvedValue(mockAsyncStream());

    const stream = provider.stream(
      [{ role: 'user' as any, content: 'hi', traceId: 't1', messageId: 'm1' }],
      [],
      ReasoningProfile.THINKING,
      'gpt-5.4'
    );

    for await (const _chunk of stream) {
      // consume
    }

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: expect.objectContaining({ effort: expect.any(String), summary: 'auto' }),
      })
    );
  });

  it('should yield thought from reasoning summary output_item.done', async () => {
    async function* mockAsyncStream() {
      yield {
        type: 'response.output_item.done',
        item: {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Reasoning summary text' }],
        },
      };
      yield { type: 'response.output_text.delta', delta: 'Final answer' };
    }

    mockCreate.mockResolvedValue(mockAsyncStream());

    const chunks = [];
    const stream = provider.stream(
      [{ role: 'user' as any, content: 'hi', traceId: 't1', messageId: 'm1' }],
      [],
      ReasoningProfile.THINKING,
      'gpt-5.4'
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks.find((c: any) => c.thought === 'Reasoning summary text')).toBeTruthy();
    expect(chunks.find((c: any) => c.content === 'Final answer')).toBeTruthy();
  });

  it('should retry streaming without reasoning.summary when unsupported', async () => {
    const unsupportedSummaryError = new Error('Unknown parameter: reasoning.summary');

    async function* fallbackStream() {
      yield { type: 'response.output_text.delta', delta: 'fallback ok' };
    }

    mockCreate
      .mockRejectedValueOnce(unsupportedSummaryError)
      .mockResolvedValueOnce(fallbackStream());

    const chunks = [];
    const stream = provider.stream(
      [{ role: 'user' as any, content: 'hi', traceId: 't1', messageId: 'm1' }],
      [],
      ReasoningProfile.THINKING,
      'gpt-5.4'
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[0][0].reasoning.summary).toBe('auto');
    expect(mockCreate.mock.calls[1][0].reasoning.summary).toBeUndefined();
    expect(chunks[0].content).toBe('fallback ok');
  });

  it('should split long reasoning summaries into multiple thought chunks', async () => {
    const longSummary =
      'This is a long reasoning summary designed to be streamed in multiple chunks so the thinking panel updates progressively rather than appearing all at once in a single block.';

    async function* mockAsyncStream() {
      yield {
        type: 'response.output_item.done',
        item: {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: longSummary }],
        },
      };
    }

    mockCreate.mockResolvedValue(mockAsyncStream());

    const thoughts: string[] = [];
    const stream = provider.stream(
      [{ role: 'user' as any, content: 'hi', traceId: 't1', messageId: 'm1' }],
      [],
      ReasoningProfile.THINKING,
      'gpt-5.4'
    );

    for await (const chunk of stream) {
      if (chunk.thought) thoughts.push(chunk.thought);
    }

    expect(thoughts.length).toBeGreaterThan(1);
    expect(thoughts.join('')).toBe(longSummary);
  });
});
