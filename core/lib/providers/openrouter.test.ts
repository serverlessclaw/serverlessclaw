import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from './openrouter';
import { MessageRole, ToolType } from '../types/index';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    OpenRouterApiKey: { value: 'test-openrouter-key' },
  },
}));

describe('OpenRouterProvider', () => {
  let provider: OpenRouterProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenRouterProvider('zhipu/glm-5');
  });

  it('should use standard OpenRouter format for aggregator models', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { role: 'assistant', content: 'Response...' } }],
        }),
    });

    await provider.call(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      []
    );

    const fetchArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchArgs[1].body);

    // Aggregator models should use standard format
    expect(body).toEqual(
      expect.objectContaining({
        model: 'zhipu/glm-5',
        messages: [{ role: 'user', content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      })
    );
  });

  it('should force json_object format for Gemini-3 models when json_schema is requested', async () => {
    provider = new OpenRouterProvider('google/gemini-3-flash-preview');

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { role: 'assistant', content: '{}' } }],
        }),
    });

    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: {
        name: 'test_schema',
        strict: true,
        schema: { type: 'object', properties: {} },
      },
    };

    await provider.call(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      [],
      undefined,
      undefined,
      undefined,
      responseFormat
    );

    const fetchArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchArgs[1].body);

    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('should correctly pass json_schema response_format for GLM models', async () => {
    provider = new OpenRouterProvider('zhipu/glm-5');

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { role: 'assistant', content: '{}' } }],
        }),
    });

    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: {
        name: 'test_schema',
        strict: true,
        schema: { type: 'object', properties: {} },
      },
    };

    await provider.call(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      [],
      undefined,
      undefined,
      undefined,
      responseFormat
    );

    const fetchArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchArgs[1].body);

    expect(body.response_format).toEqual(responseFormat);
  });

  it('should include require_parameters: true when tools are present', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { role: 'assistant', content: 'OK' } }],
        }),
    });

    const tools = [
      {
        name: 'test_tool',
        description: 'test',
        type: ToolType.FUNCTION,
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'done',
        connectionProfile: [],
        requiresApproval: false,
        requiredPermissions: [],
      },
    ];

    await provider.call(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      tools
    );

    const fetchArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchArgs[1].body);

    expect(body.provider).toEqual(
      expect.objectContaining({
        require_parameters: true,
      })
    );
  });

  it('should include google_search_retrieval for Gemini models when Google Search tool is present', async () => {
    provider = new OpenRouterProvider('google/gemini-2-flash');

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { role: 'assistant', content: 'Search result...' } }],
        }),
    });

    const tools = [
      {
        name: 'google_search',
        type: 'google_search_retrieval' as any,
        description: 'search',
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'done',
        connectionProfile: [],
        requiresApproval: false,
        requiredPermissions: [],
      },
    ];

    await provider.call(
      [
        {
          role: MessageRole.USER,
          content: 'search something',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ],
      tools
    );

    const fetchArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchArgs[1].body);

    expect(body.google_search_retrieval).toBeDefined();
    expect(body.google_search_retrieval.dynamic_retrieval).toEqual(
      expect.objectContaining({
        mode: 'unspecified',
      })
    );
  });

  it('should disable safety settings for Gemini-3 models', async () => {
    provider = new OpenRouterProvider('google/gemini-3-flash');

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { role: 'assistant', content: 'Content' } }],
        }),
    });

    await provider.call(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      []
    );

    const fetchArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchArgs[1].body);

    expect(body.safety_settings).toBe('off');
  });

  it('should report specific context window for different models', async () => {
    const geminiCaps = await provider.getCapabilities('google/gemini-3-flash-preview');
    expect(geminiCaps.contextWindow).toBe(1048576);

    // Aggregator models return default context window
    const genericCaps = await provider.getCapabilities('mistral/mistral-large');
    expect(genericCaps.contextWindow).toBe(128000);

    const defaultCaps = await provider.getCapabilities('other/model');
    expect(defaultCaps.contextWindow).toBe(128000);
  });
});
