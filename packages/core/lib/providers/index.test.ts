import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderManager } from './index';
import { MessageRole, LLMProvider } from '../types/index';

// Mocking the imported dependencies and Resource
vi.mock('sst', () => ({
  Resource: {},
}));

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn().mockImplementation((key, def) => Promise.resolve(def)),
    getRawConfig: vi.fn(),
  },
}));

vi.mock('../recursion-tracker', () => ({
  isBudgetExceeded: vi.fn().mockResolvedValue(false),
  incrementTokenUsage: vi.fn().mockResolvedValue(100),
}));

// Mock the provider implementations to avoid real API calls
vi.mock('./openai', () => ({
  OpenAIProvider: class {
    async getCapabilities() {
      return {
        supportedReasoningProfiles: ['fast', 'standard', 'thinking', 'deep'],
        supportsStructuredOutput: true,
        contextWindow: 128000,
        supportedAttachmentTypes: ['image', 'file'],
      };
    }
  },
}));

vi.mock('./bedrock', () => ({
  BedrockProvider: class {
    async getCapabilities() {
      return {
        supportedReasoningProfiles: ['fast', 'standard', 'thinking', 'deep'],
        supportsStructuredOutput: true,
        contextWindow: 200000,
        supportedAttachmentTypes: ['image', 'file'],
      };
    }
  },
}));

vi.mock('./openrouter', () => ({
  OpenRouterProvider: class {
    async getCapabilities() {
      return {
        supportedReasoningProfiles: ['fast', 'standard', 'thinking', 'deep'],
        supportsStructuredOutput: true,
        contextWindow: 128000,
        supportedAttachmentTypes: ['image', 'file'],
      };
    }
  },
}));

vi.mock('./minimax', () => ({
  MiniMaxProvider: class {
    async getCapabilities() {
      return {
        supportedReasoningProfiles: ['fast', 'standard', 'thinking', 'deep'],
        supportsStructuredOutput: true,
        contextWindow: 204800,
        supportedAttachmentTypes: ['image', 'file'],
      };
    }
  },
}));

describe('ProviderManager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('should safely fallback when ActiveProvider is not linked in SST Resource', async () => {
    const provider = await ProviderManager.getActiveProvider();
    expect(provider).toBeDefined();
    expect(provider.constructor.name).toMatch(/Provider$/);
  });

  it('should safely fallback when ActiveModel is not linked', async () => {
    const pm = new ProviderManager();
    const capabilities = await pm.getCapabilities();
    expect(capabilities).toBeDefined();
    expect(capabilities.supportedReasoningProfiles.length).toBeGreaterThan(0);
  });

  it('should return specific provider when overrideProvider is provided', async () => {
    const provider = await ProviderManager.getActiveProvider('openai', 'gpt-4');
    expect(provider).toBeDefined();
  });

  it('should return fallback provider when no override', async () => {
    const provider = await ProviderManager.getActiveProvider();
    expect(provider).toBeDefined();
  });

  it('should get active provider name', async () => {
    const { ConfigManager } = await import('../registry/config');
    (ConfigManager.getTypedConfig as any).mockResolvedValueOnce('openai');
    const pm = new ProviderManager();
    const name = await pm.getActiveProviderName();
    expect(typeof name).toBe('string');
  });

  it('should get active model name', async () => {
    const pm = new ProviderManager();
    const name = await pm.getActiveModelName();
    expect(typeof name).toBe('string');
  });

  describe('Budget Limits and Routing', () => {
    it('should route to cheaper model for simple tasks automatically based on active provider', async () => {
      const pm = new ProviderManager();
      const mockCall = vi.fn().mockResolvedValue({
        role: 'assistant',
        content: 'ok',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      vi.spyOn(ProviderManager, 'getActiveProvider').mockResolvedValueOnce({
        call: mockCall,
      } as any);

      // Default provider is OpenAI in SYSTEM constants
      await pm.call([
        { role: MessageRole.USER, content: 'hello', traceId: 'test-trace', messageId: 'test-msg' },
      ]);

      const { UTILITY_MODELS } = await import('../constants/system');
      expect(ProviderManager.getActiveProvider).toHaveBeenCalledWith(
        LLMProvider.OPENAI,
        UTILITY_MODELS[LLMProvider.OPENAI]
      );
    });

    it('should throw [BUDGET_EXCEEDED] if isBudgetExceeded returns true', async () => {
      const pm = new ProviderManager();
      const { isBudgetExceeded } = await import('../recursion-tracker');
      vi.mocked(isBudgetExceeded).mockResolvedValueOnce(true);

      await expect(
        pm.call([
          {
            role: MessageRole.USER,
            content: 'hello',
            traceId: 'test-trace',
            messageId: 'test-msg',
          },
        ])
      ).rejects.toThrow(/\[BUDGET_EXCEEDED\]/);
    });

    it('should not route to Haiku when provider is explicitly set', async () => {
      const pm = new ProviderManager();

      const mockCall = vi.fn().mockResolvedValue({ role: 'assistant', content: 'ok' });

      vi.spyOn(ProviderManager, 'getActiveProvider').mockResolvedValueOnce({
        call: mockCall,
      } as any);

      await pm.call(
        [
          {
            role: MessageRole.USER,
            content: 'hello',
            traceId: 'test-trace',
            messageId: 'test-msg',
          },
        ],
        undefined,
        undefined,
        undefined,
        LLMProvider.OPENAI
      );

      expect(ProviderManager.getActiveProvider).toHaveBeenCalledWith(LLMProvider.OPENAI, undefined);
    });

    it('should not route to Haiku when model is explicitly set', async () => {
      const pm = new ProviderManager();

      const mockCall = vi.fn().mockResolvedValue({ role: 'assistant', content: 'ok' });

      vi.spyOn(ProviderManager, 'getActiveProvider').mockResolvedValueOnce({
        call: mockCall,
      } as any);

      await pm.call(
        [
          {
            role: MessageRole.USER,
            content: 'hello',
            traceId: 'test-trace',
            messageId: 'test-msg',
          },
        ],
        undefined,
        undefined,
        'gpt-4'
      );

      expect(ProviderManager.getActiveProvider).toHaveBeenCalledWith(undefined, 'gpt-4');
    });

    it('should fall back to session-aware traceId if no traceId is found in messages', async () => {
      const pm = new ProviderManager();
      const { incrementTokenUsage } = await import('../recursion-tracker');

      const mockCall = vi.fn().mockResolvedValue({
        role: 'assistant',
        content: 'ok',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      vi.spyOn(ProviderManager, 'getActiveProvider').mockResolvedValueOnce({
        call: mockCall,
      } as any);

      // Messages with sessionId but NO traceId
      await pm.call([
        {
          role: MessageRole.USER,
          content: 'hello',
          sessionId: 'session-123',
          traceId: 'unknown',
          messageId: 'test-msg',
        } as any,
      ]);

      // Should use 'session-session-123' as traceId
      expect(incrementTokenUsage).toHaveBeenCalledWith('session-session-123', expect.any(Number));
    });
  });

  describe('Streaming', () => {
    it('should throw [BUDGET_EXCEEDED] in stream if isBudgetExceeded returns true', async () => {
      const pm = new ProviderManager();
      const { isBudgetExceeded } = await import('../recursion-tracker');
      vi.mocked(isBudgetExceeded).mockResolvedValueOnce(true);

      const stream = pm.stream([
        {
          role: MessageRole.USER,
          content: 'hello',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ]);
      await expect(async () => {
        for await (const _ of stream) {
          // no-op
        }
      }).rejects.toThrow(/\[BUDGET_EXCEEDED\]/);
    });

    it('should route to utility model in stream for simple tasks', async () => {
      const mockStream = vi.fn().mockReturnValue(
        (async function* () {
          yield {
            role: 'assistant',
            content: 'hi',
            usage: { prompt_tokens: 5, completion_tokens: 2 },
          };
        })()
      );

      vi.spyOn(ProviderManager, 'getActiveProvider').mockResolvedValueOnce({
        stream: mockStream,
      } as any);

      const pm = new ProviderManager();
      const messages = [
        { role: MessageRole.USER, content: 'hi', traceId: 'test-trace', messageId: 'test-msg' },
      ];

      for await (const _ of pm.stream(messages)) {
        // consume the async iterable
      }

      const { UTILITY_MODELS } = await import('../constants/system');
      expect(ProviderManager.getActiveProvider).toHaveBeenCalledWith(
        LLMProvider.OPENAI,
        UTILITY_MODELS[LLMProvider.OPENAI]
      );
    });
  });

  describe('Fallback Provider', () => {
    it('should create fallback provider with primary and fallbacks', async () => {
      const fallback = await ProviderManager.createFallbackProvider(LLMProvider.OPENAI, [
        LLMProvider.BEDROCK,
      ]);
      expect(fallback).toBeDefined();
    });

    it('should create fallback provider with default fallbacks', async () => {
      const fallback = await ProviderManager.createFallbackProvider(LLMProvider.MINIMAX);
      expect(fallback).toBeDefined();
    });

    it('should create fallback provider with no primary', async () => {
      const fallback = await ProviderManager.createFallbackProvider();
      expect(fallback).toBeDefined();
    });
  });
});
