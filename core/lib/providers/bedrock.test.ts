import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BedrockProvider } from './bedrock';
import { MessageRole, ReasoningProfile } from '../types/index';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

// Mock Bedrock SDK
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  return {
    BedrockRuntimeClient: vi.fn().mockImplementation(function () {
      return { send: mockSend };
    }),
    ConverseCommand: vi.fn().mockImplementation(function (args) {
      return args;
    }),
    MessageRole: {
      ASSISTANT: 'assistant',
      USER: 'user',
      SYSTEM: 'system',
    },
  };
});

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    AwsRegion: { value: 'us-east-1' },
  },
}));

describe('BedrockProvider', () => {
  let provider: BedrockProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new BedrockProvider('claude-sonnet-4-6');
  });

  it('should apply correct thinking budgets for different reasoning profiles', async () => {
    mockSend.mockResolvedValue({
      output: { message: { role: 'assistant', content: [{ text: 'Hello' }] } },
    });

    // Test DEEP profile
    await provider.call([{ role: MessageRole.USER, content: 'test' }], [], ReasoningProfile.DEEP);

    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalModelRequestFields: expect.objectContaining({
          thinking: { type: 'enabled', budget_tokens: 32768 },
        }),
      })
    );

    // Test FAST profile (thinking should be disabled)
    vi.clearAllMocks();
    await provider.call([{ role: MessageRole.USER, content: 'test' }], [], ReasoningProfile.FAST);

    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.not.objectContaining({
        additionalModelRequestFields: expect.objectContaining({
          thinking: expect.anything(),
        }),
      })
    );
  });

  it('should format multi-modal attachments correctly for Bedrock Converse API', async () => {
    mockSend.mockResolvedValue({
      output: { message: { role: 'assistant', content: [{ text: 'I see your image' }] } },
    });

    const messages = [
      {
        role: MessageRole.USER,
        content: 'What is this?',
        attachments: [
          {
            type: 'image',
            name: 'test.png',
            base64: 'SGVsbG8=',
            mimeType: 'image/png',
          },
        ],
      },
    ];

    await provider.call(messages as any, []);

    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ text: 'What is this?' }),
              expect.objectContaining({
                image: expect.objectContaining({ format: 'png' }),
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('should handle tool calls and tool results', async () => {
    mockSend.mockResolvedValue({
      output: { message: { role: 'assistant', content: [{ text: 'Done' }] } },
    });

    const messages = [
      { role: MessageRole.USER, content: 'call tool' },
      {
        role: MessageRole.ASSISTANT,
        content: '',
        tool_calls: [{ id: 'tc1', function: { name: 'test_tool', arguments: '{}' } }],
      },
      {
        role: MessageRole.TOOL,
        content: 'tool result',
        tool_call_id: 'tc1',
      },
    ];

    await provider.call(messages as any, []);

    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                toolResult: expect.objectContaining({ toolUseId: 'tc1' }),
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('should include outputConfig: { format: "json" } when responseFormat is requested', async () => {
    mockSend.mockResolvedValue({
      output: { message: { role: 'assistant', content: [{ text: '{}' }] } },
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
      [{ role: MessageRole.USER, content: 'test' }],
      [],
      undefined,
      undefined,
      undefined,
      responseFormat
    );

    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        outputConfig: {
          format: 'json',
        },
      })
    );
  });

  it('should report correct capabilities for Claude 4.6', async () => {
    const caps = await provider.getCapabilities('claude-sonnet-4-6');
    expect(caps.supportsStructuredOutput).toBe(true);
    expect(caps.supportedReasoningProfiles).toContain(ReasoningProfile.DEEP);
  });
});
