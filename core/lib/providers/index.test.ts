import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderManager } from './index';

// Mocking the imported dependencies and Resource
vi.mock('sst', () => ({
  Resource: {},
}));

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn(),
    getRawConfig: vi.fn(),
  },
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
    // SST Resource is mocked as `{}` above, meaning 'ActiveProvider' is not in Resource.
    // getActiveProvider should not throw a TypeError and should fallback to system default.
    const provider = await ProviderManager.getActiveProvider();

    // Default provider is 'minimax' if no config is found and Resource is empty
    expect(provider).toBeDefined();
    // The actual default is determined by the constants module which is not mocked
    // So we just verify that a provider is returned
    expect(provider.constructor.name).toMatch(/Provider$/);
  });

  it('should safely fallback when ActiveModel is not linked', async () => {
    const pm = new ProviderManager();
    const capabilities = await pm.getCapabilities();
    expect(capabilities).toBeDefined();
    // Default profile support
    expect(capabilities.supportedReasoningProfiles.length).toBeGreaterThan(0);
  });
});
