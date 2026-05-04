/**
 * @module ProtocolFallback Tests
 * @description Tests for JSON→Text fallback chain, malformed JSON extraction,
 * streaming fallback, and retry logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callWithFallback, streamWithFallback } from './protocol-fallback';

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../providers/utils', () => ({
  normalizeProfile: vi.fn((_profile: string) => 'standard'),
}));

vi.mock('./schema', () => ({
  DEFAULT_SIGNAL_SCHEMA: {
    type: 'json_schema',
    json_schema: { schema: { required: ['responseText'] } },
  },
}));

function createMockProvider(overrides: Partial<any> = {}) {
  return {
    call: overrides.call ?? vi.fn().mockResolvedValue({ content: '{"responseText":"hello"}' }),
    stream:
      overrides.stream ??
      vi.fn().mockImplementation(async function* () {
        yield { content: '{"responseText"' };
        yield { content: ':"hello"}' };
      }),
    getCapabilities:
      overrides.getCapabilities ??
      vi.fn().mockResolvedValue({
        supportsStructuredOutput: true,
      }),
  };
}

const defaultOptions = {
  communicationMode: 'text' as const,
  activeModel: 'gpt-4',
  activeProvider: 'openai',
  activeProfile: 'standard' as any,
};

const jsonOptions = {
  ...defaultOptions,
  communicationMode: 'json' as const,
};

describe('callWithFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns directly in text mode', async () => {
    const provider = createMockProvider();
    const result = await callWithFallback(provider as any, [], [], defaultOptions);

    expect(result.usedFallback).toBe(false);
    expect(result.originalMode).toBe('text');
    expect(result.response.content).toBe('{"responseText":"hello"}');
  });

  it('returns valid JSON response without fallback', async () => {
    const provider = createMockProvider();
    const result = await callWithFallback(provider as any, [], [], {
      ...defaultOptions,
      communicationMode: 'json',
    });

    expect(result.usedFallback).toBe(false);
    expect(result.originalMode).toBe('json');
  });

  it('extracts message from malformed JSON', async () => {
    const provider = createMockProvider({
      call: vi.fn().mockResolvedValue({ content: '{"message":"extracted text","broken' }),
    });
    const result = await callWithFallback(provider as any, [], [], jsonOptions);

    expect(result.usedFallback).toBe(true);
    expect(result.response.content).toBe('extracted text');
  });

  it('retries in text mode when JSON parse fails and no extraction possible', async () => {
    const provider = createMockProvider({
      call: vi
        .fn()
        .mockResolvedValueOnce({ content: 'not json at all' })
        .mockResolvedValueOnce({ content: 'text response' }),
    });
    const result = await callWithFallback(provider as any, [], [], {
      ...defaultOptions,
      communicationMode: 'json',
    });

    expect(result.usedFallback).toBe(true);
    expect(result.fallbackMode).toBe('text');
    expect(provider.call).toHaveBeenCalledTimes(2);
  });

  it('retries in text mode when provider throws in JSON mode', async () => {
    const provider = createMockProvider({
      call: vi
        .fn()
        .mockRejectedValueOnce(new Error('Provider error'))
        .mockResolvedValueOnce({ content: 'recovered' }),
    });
    const result = await callWithFallback(provider as any, [], [], {
      ...defaultOptions,
      communicationMode: 'json',
    });

    expect(result.usedFallback).toBe(true);
    expect(result.response.content).toBe('recovered');
  });

  it('throws original error when both JSON and text modes fail', async () => {
    const provider = createMockProvider({
      call: vi
        .fn()
        .mockRejectedValueOnce(new Error('JSON error'))
        .mockRejectedValueOnce(new Error('Text error')),
    });

    await expect(
      callWithFallback(provider as any, [], [], {
        ...defaultOptions,
        communicationMode: 'json',
      })
    ).rejects.toThrow('JSON error');
  });

  it('returns original response when maxRetries is 0 and JSON fails', async () => {
    const provider = createMockProvider({
      call: vi.fn().mockResolvedValue({ content: 'not valid json' }),
    });
    const result = await callWithFallback(provider as any, [], [], {
      ...defaultOptions,
      communicationMode: 'json',
      maxRetries: 0,
    });

    expect(result.usedFallback).toBe(false);
    expect(result.parseError).toContain('no fallback');
  });

  it('skips schema when provider does not support structured output', async () => {
    const provider = createMockProvider({
      getCapabilities: vi.fn().mockResolvedValue({ supportsStructuredOutput: false }),
    });
    await callWithFallback(provider as any, [], [], {
      ...defaultOptions,
      communicationMode: 'json',
    });

    const callArgs = (provider.call as any).mock.calls[0];
    expect(callArgs[5]).toBeUndefined();
  });

  it('handles empty content by triggering fallback', async () => {
    const provider = createMockProvider({
      call: vi
        .fn()
        .mockResolvedValueOnce({ content: '' })
        .mockResolvedValueOnce({ content: 'fallback text' }),
    });
    const result = await callWithFallback(provider as any, [], [], {
      ...defaultOptions,
      communicationMode: 'json',
    });

    expect(result.usedFallback).toBe(true);
  });

  it('throws when provider throws in text mode with no retries', async () => {
    const provider = createMockProvider({
      call: vi.fn().mockRejectedValue(new Error('fatal')),
    });

    await expect(
      callWithFallback(provider as any, [], [], {
        ...defaultOptions,
        communicationMode: 'json',
        maxRetries: 0,
      })
    ).rejects.toThrow('fatal');
  });
});

describe('streamWithFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('streams content in text mode without fallback', async () => {
    const provider = createMockProvider({
      stream: vi.fn().mockImplementation(async function* () {
        yield { content: 'hello ' };
        yield { content: 'world' };
      }),
    });

    const chunks: any[] = [];
    for await (const chunk of streamWithFallback(provider as any, [], [], {
      ...defaultOptions,
      communicationMode: 'text',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('hello ');
  });

  it('streams valid JSON in json mode', async () => {
    const provider = createMockProvider({
      stream: vi.fn().mockImplementation(async function* () {
        yield { content: '{"responseText": "hello"}' };
      }),
    });

    const chunks: any[] = [];
    for await (const chunk of streamWithFallback(provider as any, [], [], {
      ...jsonOptions,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
  });
});
