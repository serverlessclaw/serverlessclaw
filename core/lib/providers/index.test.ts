import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderManager } from './index';
import { LLMProvider } from '../types/index';
import { OpenAIProvider } from './openai';
import { OpenRouterProvider } from './openrouter';
import { BedrockProvider } from './bedrock';
import { ConfigManager } from '../registry/config';
import { Resource } from 'sst';
import { SYSTEM, CONFIG_KEYS } from '../constants';

// Mock all providers
vi.mock('./openai', () => ({
  OpenAIProvider: vi.fn().mockImplementation(function (model) {
    return { model, call: vi.fn(), getCapabilities: vi.fn() };
  }),
}));
vi.mock('./openrouter', () => ({
  OpenRouterProvider: vi.fn().mockImplementation(function (model) {
    return { model, call: vi.fn(), getCapabilities: vi.fn() };
  }),
}));
vi.mock('./bedrock', () => ({
  BedrockProvider: vi.fn().mockImplementation(function (model) {
    return { model, call: vi.fn(), getCapabilities: vi.fn() };
  }),
}));

// Mock ConfigManager
vi.mock('../registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    getTypedConfig: vi.fn(),
  },
}));

vi.mock('../constants', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    SYSTEM: {
      ...actual.SYSTEM,
      DEFAULT_PROVIDER: 'openai',
      DEFAULT_OPENAI_MODEL: 'gpt-5.4',
      DEFAULT_BEDROCK_MODEL: 'claude-4-6',
      DEFAULT_OPENROUTER_MODEL: 'gemini-3',
    },
    CONFIG_KEYS: {
      ...actual.CONFIG_KEYS,
      ACTIVE_PROVIDER: 'active_provider',
      ACTIVE_MODEL: 'active_model',
    },
  };
});

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {},
}));

describe('ProviderManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getActiveProvider Resolution Hierarchy', () => {
    it('1. should resolve via direct overrides (highest priority)', async () => {
      await ProviderManager.getActiveProvider(LLMProvider.OPENROUTER, 'custom-model');
      expect(OpenRouterProvider).toHaveBeenCalledWith('custom-model');
    });

    it('2. should resolve via hot configuration (DynamoDB)', async () => {
      vi.mocked(ConfigManager.getTypedConfig).mockResolvedValue(LLMProvider.BEDROCK);
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValue('hot-model');

      await (ProviderManager as any).getActiveProvider();

      expect(ConfigManager.getTypedConfig).toHaveBeenCalledWith(
        CONFIG_KEYS.ACTIVE_PROVIDER,
        expect.anything()
      );
      expect(ConfigManager.getRawConfig).toHaveBeenCalledWith(CONFIG_KEYS.ACTIVE_MODEL);
      expect(BedrockProvider).toHaveBeenCalledWith('hot-model');
    });

    it('3. should resolve via SST Static Resources', async () => {
      // Mock SST Resource values
      (Resource as any).ActiveProvider = { value: LLMProvider.OPENROUTER };
      (Resource as any).ActiveModel = { value: 'sst-model' };

      vi.mocked(ConfigManager.getTypedConfig).mockImplementation((key, fallback) =>
        Promise.resolve(fallback)
      );
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValue(undefined);

      await (ProviderManager as any).getActiveProvider();
      expect(OpenRouterProvider).toHaveBeenCalledWith('sst-model');

      // Cleanup mock
      delete (Resource as any).ActiveProvider;
      delete (Resource as any).ActiveModel;
    });

    it('4. should fallback to system constants (lowest priority)', async () => {
      vi.mocked(ConfigManager.getTypedConfig).mockImplementation((key, fallback) =>
        Promise.resolve(fallback)
      );
      vi.mocked(ConfigManager.getRawConfig).mockResolvedValue(undefined);

      await (ProviderManager as any).getActiveProvider();

      expect(OpenAIProvider).toHaveBeenCalledWith(SYSTEM.DEFAULT_OPENAI_MODEL);
    });
  });

  describe('call delegation', () => {
    it('should delegate the call to the resolved provider', async () => {
      const mockCall = vi.fn().mockResolvedValue({ role: 'assistant', content: 'hello' });
      vi.mocked(OpenAIProvider).mockImplementation(function () {
        return { call: mockCall, getCapabilities: vi.fn() } as any;
      });

      const manager = new ProviderManager();
      const result = await manager.call([{ role: 'user', content: 'hi' } as any]);

      expect(mockCall).toHaveBeenCalled();
      expect(result.content).toBe('hello');
    });
  });
});
