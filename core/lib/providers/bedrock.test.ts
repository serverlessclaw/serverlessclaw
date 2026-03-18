import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BedrockProvider } from './bedrock';
import { MessageRole } from '../types/index';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';

const bedrockMock = mockClient(BedrockRuntimeClient);

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    AwsRegion: { value: 'us-east-1' },
  },
}));

describe('BedrockProvider', () => {
  let provider: BedrockProvider;

  beforeEach(() => {
    bedrockMock.reset();
    vi.clearAllMocks();
    provider = new BedrockProvider('anthropic.claude-3-5-sonnet-20241022-v2:0');
  });

  it('should correctly map computer_use tool for Anthropic', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { content: [{ text: 'Hello' }], role: 'assistant' } },
    });

    const tools = [
      {
        name: 'computer',
        description: 'Standard computer tool',
        type: 'computer_use' as const,
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'done',
      },
    ];

    await provider.call([{ role: MessageRole.USER, content: 'test' }], tools);

    const calls = bedrockMock.commandCalls(ConverseCommand);
    const input = calls[0].args[0].input;

    expect(input.toolConfig?.tools).toBeDefined();
    // In our implementation, computer_use tools are mapped to a specific format
    // that doesn't use the standard toolSpec for computer_use type
    expect(input.toolConfig?.tools![0]).toHaveProperty('computer');
  });
});
