import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from './openrouter';
import { MessageRole } from '../types/index';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    OpenRouterApiKey: { value: 'test-openrouter-key' },
  },
}));

/**
 * Helper to create a mock ReadableStream from SSE lines.
 */
function createSSEStream(lines: string[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(new TextEncoder().encode(line + '\n'));
      }
      controller.close();
    },
  });
}

describe('OpenRouterProvider.stream', () => {
  let provider: OpenRouterProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenRouterProvider('zhipu/glm-5');
  });

  it('should yield text chunks from SSE stream', async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: {"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
      'data: [DONE]',
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      body: createSSEStream(sseLines),
    });

    const chunks: any[] = [];
    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'hi', traceId: 'test-trace', messageId: 'test-msg' }],
      []
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const contentChunks = chunks.filter((c) => c.content);
    expect(contentChunks).toHaveLength(2);
    expect(contentChunks[0].content).toBe('Hello');
    expect(contentChunks[1].content).toBe(' world');
  });

  it('should yield thought chunks from reasoning_details', async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"reasoning_details":[{"text":"Let me analyze..."}]}}]}',
      'data: {"choices":[{"delta":{"content":"Answer"}}]}',
      'data: [DONE]',
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      body: createSSEStream(sseLines),
    });

    const chunks: any[] = [];
    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'think', traceId: 'test-trace', messageId: 'test-msg' }],
      []
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks[0].thought).toBe('Let me analyze...');
    expect(chunks[1].content).toBe('Answer');
  });

  it('should yield thought chunks from reasoning string field', async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"reasoning":"Analyzing..."}}]}',
      'data: {"choices":[{"delta":{"content":"Done"}}]}',
      'data: [DONE]',
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      body: createSSEStream(sseLines),
    });

    const chunks: any[] = [];
    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      []
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks[0].thought).toBe('Analyzing...');
    expect(chunks[1].content).toBe('Done');
  });

  it('should yield tool call chunks from stream', async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"my_tool","arguments":"{\\"foo\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"","arguments":"\\"bar\\"}"}}]}}]}',
      'data: [DONE]',
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      body: createSSEStream(sseLines),
    });

    const chunks: any[] = [];
    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'do it', traceId: 'test-trace', messageId: 'test-msg' }],
      []
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const toolChunks = chunks.filter((c) => c.tool_calls);
    expect(toolChunks).toHaveLength(2);
    expect(toolChunks[0].tool_calls?.[0].function.name).toBe('my_tool');
  });

  it('should yield usage from final chunk', async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"OK"}}]}',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}',
      'data: [DONE]',
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      body: createSSEStream(sseLines),
    });

    const chunks: any[] = [];
    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'hi', traceId: 'test-trace', messageId: 'test-msg' }],
      []
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const usageChunk = chunks.find((c) => c.usage);
    expect(usageChunk).toBeDefined();
    expect(usageChunk?.usage?.total_tokens).toBe(13);
  });

  it('should yield fallback text on fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const chunks: any[] = [];
    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      []
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(' (Streaming failed)');
  });

  it('should yield fallback text on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limited'),
    });

    const chunks: any[] = [];
    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      []
    );

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(' (Streaming failed)');
  });

  it('should include stream: true in request body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: createSSEStream(['data: [DONE]']),
    });

    const stream = provider.stream(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      []
    );

    for await (const _chunk of stream) {
      // drain
    }

    const fetchArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchArgs[1].body);
    expect(body.stream).toBe(true);
  });
});
