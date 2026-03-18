import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from './openrouter';
import { MessageRole } from '../types/index';

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    OpenRouterApiKey: { value: 'test-key' },
  },
}));

describe('OpenRouterProvider', () => {
  let provider: OpenRouterProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenRouterProvider('google/gemini-pro-1.5');

    // Mock global fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello', role: 'assistant' } }],
      }),
    });
  });

  it('should correctly map different tool types and add grounded search for Gemini', async () => {
    const tools = [
      {
        name: 'local_tool',
        description: 'A local tool',
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'done',
      },
      {
        name: 'google_search',
        description: 'Grounded search',
        type: 'google_search_retrieval' as const,
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'done',
      },
    ];

    await provider.call([{ role: MessageRole.USER, content: 'test' }], tools);

    const fetchCalls = vi.mocked(global.fetch).mock.calls;
    const body = JSON.parse(fetchCalls[0][1]?.body as string);

    expect(body.tools).toHaveLength(2);
    expect(body.tools[0]).toMatchObject({ type: 'function' });
    expect(body.tools[1]).toMatchObject({ type: 'google_search_retrieval' });

    // Check for Gemini-specific grounded search config
    expect(body.google_search_retrieval).toBeDefined();
    expect(body.google_search_retrieval.dynamic_retrieval).toBeDefined();
  });
});
