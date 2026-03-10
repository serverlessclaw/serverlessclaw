import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use a shared mock object that can be updated from tests
const dbState = {
  config: {} as Record<string, string>,
};

vi.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: {
      from: () => ({
        send: vi.fn().mockImplementation((command) => {
          const key = command.input.Key.key;
          return Promise.resolve({
            Item: dbState.config[key] ? { value: dbState.config[key] } : null,
          });
        }),
      }),
    },

    GetCommand: class {
      constructor(public input: unknown) {}
    },

    PutCommand: class {
      constructor(public input: unknown) {}
    },
  };
});

vi.mock('sst', () => ({
  Resource: {
    ActiveProvider: { value: 'openai' },
    ActiveModel: { value: 'gpt-5.4' },
    ConfigTable: { name: 'MockConfigTable' },
    OpenAIApiKey: { value: 'sk-mock-openai' },
    OpenRouterApiKey: { value: 'sk-mock-openrouter' },
    AwsRegion: { value: 'us-east-1' },
  },
}));

import { ProviderManager } from './providers/index';
import { OpenAIProvider } from './providers/openai';
import { BedrockProvider } from './providers/bedrock';
import { OpenRouterProvider } from './providers/openrouter';

describe('ProviderManager', () => {
  beforeEach(() => {
    dbState.config = {};
  });

  it('should default to OpenAI if no hot config exists', async () => {
    const provider = await ProviderManager.getActiveProvider();
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('should switch to Bedrock when active_provider is set in DynamoDB', async () => {
    dbState.config['active_provider'] = 'bedrock';
    const provider = await ProviderManager.getActiveProvider();
    expect(provider).toBeInstanceOf(BedrockProvider);
  });

  it('should switch to OpenRouter with correct model from DynamoDB', async () => {
    dbState.config['active_provider'] = 'openrouter';
    dbState.config['active_model'] = 'anthropic/claude-3.5-sonnet';

    const provider = await ProviderManager.getActiveProvider();
    expect(provider).toBeInstanceOf(OpenRouterProvider);
    // @ts-expect-error - testing private property
    expect(provider.model).toBe('anthropic/claude-3.5-sonnet');
  });
});
