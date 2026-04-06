/**
 * @module FallbackProvider Tests
 * @description Tests for provider fallback chain with circuit breakers,
 * health tracking, cooldown recovery, and streaming fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FallbackProvider } from './fallback';
import { LLMProvider, ReasoningProfile } from '../types/index';

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createMockProviderInstance(overrides: Partial<any> = {}) {
  return {
    call: overrides.call ?? vi.fn().mockResolvedValue({ content: 'response' }),
    stream:
      overrides.stream ??
      vi.fn().mockImplementation(async function* () {
        yield { content: 'chunk' };
      }),
    getCapabilities:
      overrides.getCapabilities ??
      vi.fn().mockResolvedValue({
        contextWindow: 8000,
      }),
  };
}

const mockProviders: Record<string, any> = {};

vi.mock('./openai', () => ({
  OpenAIProvider: vi.fn().mockImplementation(function (this: any) {
    Object.assign(this, mockProviders['openai'] ?? createMockProviderInstance());
  }),
}));
vi.mock('./bedrock', () => ({
  BedrockProvider: vi.fn().mockImplementation(function (this: any) {
    Object.assign(this, mockProviders['bedrock'] ?? createMockProviderInstance());
  }),
}));
vi.mock('./openrouter', () => ({
  OpenRouterProvider: vi.fn().mockImplementation(function (this: any) {
    Object.assign(this, mockProviders['openrouter'] ?? createMockProviderInstance());
  }),
}));
vi.mock('./minimax', () => ({
  MiniMaxProvider: vi.fn().mockImplementation(function (this: any) {
    Object.assign(this, mockProviders['minimax'] ?? createMockProviderInstance());
  }),
}));

describe('FallbackProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset per-provider mocks
    delete mockProviders['openai'];
    delete mockProviders['bedrock'];
    delete mockProviders['openrouter'];
    delete mockProviders['minimax'];
  });

  describe('call', () => {
    it('returns result from primary provider on success', async () => {
      const provider = new FallbackProvider({
        primary: LLMProvider.OPENAI,
        fallbacks: [LLMProvider.BEDROCK],
      });

      const result = await provider.call(
        [{ role: 'user' as any, content: 'hello', traceId: 't1', messageId: 'm1' }],
        [],
        ReasoningProfile.STANDARD
      );

      expect(result).toEqual({ content: 'response' });
    });

    it('falls back to secondary when primary fails', async () => {
      mockProviders['openai'] = createMockProviderInstance({
        call: vi.fn().mockRejectedValue(new Error('OpenAI down')),
      });
      mockProviders['bedrock'] = createMockProviderInstance({
        call: vi.fn().mockResolvedValue({ content: 'bedrock response' }),
      });

      const provider = new FallbackProvider({
        primary: LLMProvider.OPENAI,
        fallbacks: [LLMProvider.BEDROCK],
      });

      const result = await provider.call(
        [{ role: 'user' as any, content: 'hello', traceId: 't1', messageId: 'm1' }],
        [],
        ReasoningProfile.STANDARD
      );

      expect(result).toEqual({ content: 'bedrock response' });
    });

    it('throws when all providers fail', async () => {
      mockProviders['openai'] = createMockProviderInstance({
        call: vi.fn().mockRejectedValue(new Error('OpenAI down')),
      });
      mockProviders['bedrock'] = createMockProviderInstance({
        call: vi.fn().mockRejectedValue(new Error('Bedrock down')),
      });

      const provider = new FallbackProvider({
        primary: LLMProvider.OPENAI,
        fallbacks: [LLMProvider.BEDROCK],
      });

      await expect(
        provider.call(
          [{ role: 'user' as any, content: 'hello', traceId: 't1', messageId: 'm1' }],
          [],
          ReasoningProfile.STANDARD
        )
      ).rejects.toThrow('All LLM providers failed');
    });

    it('uses specific provider when requested directly', async () => {
      const provider = new FallbackProvider({
        primary: LLMProvider.OPENAI,
        fallbacks: [LLMProvider.BEDROCK],
      });

      const result = await provider.call(
        [{ role: 'user' as any, content: 'hello', traceId: 't1', messageId: 'm1' }],
        [],
        ReasoningProfile.STANDARD,
        undefined,
        'bedrock'
      );

      expect(result).toEqual({ content: 'response' });
    });

    it('opens circuit after threshold failures', async () => {
      mockProviders['openai'] = createMockProviderInstance({
        call: vi.fn().mockRejectedValue(new Error('down')),
      });
      mockProviders['bedrock'] = createMockProviderInstance({
        call: vi.fn().mockResolvedValue({ content: 'fallback ok' }),
      });

      const provider = new FallbackProvider({
        primary: LLMProvider.OPENAI,
        fallbacks: [LLMProvider.BEDROCK],
        failureThreshold: 2,
      });

      // First two calls should try primary then fallback
      const mockMsg = [{ role: 'user' as any, content: 'hi', traceId: 't1', messageId: 'm1' }];
      await provider.call(mockMsg, [], ReasoningProfile.STANDARD);
      await provider.call(mockMsg, [], ReasoningProfile.STANDARD);

      // Third call should skip primary entirely (circuit open)
      await provider.call(mockMsg, [], ReasoningProfile.STANDARD);

      const status = provider.getHealthStatus();
      expect(status[LLMProvider.OPENAI].healthy).toBe(false);
    });
  });

  describe('stream', () => {
    it('streams from primary provider', async () => {
      const provider = new FallbackProvider({
        primary: LLMProvider.OPENAI,
        fallbacks: [LLMProvider.BEDROCK],
      });

      const chunks: any[] = [];
      for await (const chunk of provider.stream(
        [{ role: 'user' as any, content: 'hello', traceId: 't1', messageId: 'm1' }],
        [],
        ReasoningProfile.STANDARD
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('chunk');
    });

    it('falls back on stream failure', async () => {
      mockProviders['openai'] = createMockProviderInstance({
        stream: vi.fn().mockImplementation(
          // eslint-disable-next-line require-yield
          async function* () {
            throw new Error('stream failed');
          }
        ),
      });
      mockProviders['bedrock'] = createMockProviderInstance({
        stream: vi.fn().mockImplementation(async function* () {
          yield { content: 'bedrock chunk' };
        }),
      });

      const provider = new FallbackProvider({
        primary: LLMProvider.OPENAI,
        fallbacks: [LLMProvider.BEDROCK],
      });

      const chunks: any[] = [];
      for await (const chunk of provider.stream(
        [{ role: 'user' as any, content: 'hello', traceId: 't1', messageId: 'm1' }],
        [],
        ReasoningProfile.STANDARD
      )) {
        chunks.push(chunk);
      }

      expect(chunks[0].content).toBe('bedrock chunk');
    });
  });

  describe('getCapabilities', () => {
    it('returns capabilities from healthy provider', async () => {
      const provider = new FallbackProvider({
        primary: LLMProvider.OPENAI,
        fallbacks: [LLMProvider.BEDROCK],
      });

      const caps = await provider.getCapabilities();
      expect(caps.contextWindow).toBe(8000);
    });
  });

  describe('resetProvider', () => {
    it('resets circuit breaker for a specific provider', async () => {
      mockProviders['openai'] = createMockProviderInstance({
        call: vi.fn().mockRejectedValue(new Error('down')),
      });

      const provider = new FallbackProvider({
        primary: LLMProvider.OPENAI,
        fallbacks: [LLMProvider.BEDROCK],
        failureThreshold: 1,
      });

      // Trigger circuit open
      try {
        await provider.call(
          [{ role: 'user' as any, content: 'hi', traceId: 't1', messageId: 'm1' }],
          [],
          ReasoningProfile.STANDARD
        );
      } catch {
        /* expected: all providers fail */
      }

      let status = provider.getHealthStatus();
      expect(status[LLMProvider.OPENAI].healthy).toBe(false);

      // Reset
      provider.resetProvider(LLMProvider.OPENAI);
      status = provider.getHealthStatus();
      expect(status[LLMProvider.OPENAI].healthy).toBe(true);
    });
  });

  describe('resetAll', () => {
    it('resets all circuit breakers', async () => {
      const provider = new FallbackProvider({
        primary: LLMProvider.OPENAI,
        fallbacks: [LLMProvider.BEDROCK],
      });

      provider.resetAll();
      const status = provider.getHealthStatus();
      expect(status[LLMProvider.OPENAI].healthy).toBe(true);
      expect(status[LLMProvider.BEDROCK].healthy).toBe(true);
    });
  });

  describe('getHealthStatus', () => {
    it('returns a copy of health map', async () => {
      const provider = new FallbackProvider({
        primary: LLMProvider.OPENAI,
        fallbacks: [LLMProvider.BEDROCK],
      });

      const status1 = provider.getHealthStatus();
      const status2 = provider.getHealthStatus();
      expect(status1).not.toBe(status2);
      expect(status1).toEqual(status2);
    });
  });
});
