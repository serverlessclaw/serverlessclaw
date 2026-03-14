import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai';
import { OpenRouterProvider } from './openrouter';
import { BedrockProvider } from './bedrock';
import { MessageRole, OpenAIModel, BedrockModel, OpenRouterModel } from '../types/index';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';

// Mock OpenAI SDK
const mockCreateResponse = vi.fn();
const mockCreateChatCompletion = vi.fn();

vi.mock('openai', () => {
  return {
    default: class {
      responses = {
        create: mockCreateResponse,
      };
      chat = {
        completions: {
          create: mockCreateChatCompletion,
        },
      };
    },
  };
});

// Mock Bedrock SDK
const bedrockMock = mockClient(BedrockRuntimeClient);

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    OpenAIApiKey: { value: 'test-openai-key' },
    OpenRouterApiKey: { value: 'test-openrouter-key' },
    AwsRegion: { value: 'us-east-1' },
  },
}));

// Mock fetch for OpenRouter
global.fetch = vi.fn();

describe('Provider Attachments Mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bedrockMock.reset();
  });

  describe('OpenAIProvider', () => {
    it('should correctly map images and files for Responses API (GPT-5.4)', async () => {
      const provider = new OpenAIProvider(OpenAIModel.GPT_5_4);
      mockCreateResponse.mockResolvedValue({
        output_text: 'Hello',
        output: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const messages = [
        {
          role: MessageRole.USER,
          content: 'Look at this',
          attachments: [
            { type: 'image' as const, base64: 'imgdata', mimeType: 'image/png' },
            {
              type: 'file' as const,
              base64: 'filedata',
              mimeType: 'application/pdf',
              name: 'test.pdf',
            },
          ],
        },
      ];

      await provider.call(messages);

      expect(mockCreateResponse).toHaveBeenCalled();
      const input = mockCreateResponse.mock.calls[0][0].input;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userMessage = input.find((i: any) => i.type === 'message' && i.role === 'user');

      expect(userMessage.content).toHaveLength(3); // text + image + file
      expect(userMessage.content[0]).toEqual({ type: 'input_text', text: 'Look at this' });
      expect(userMessage.content[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,imgdata' },
      });
      expect(userMessage.content[2]).toEqual({
        type: 'input_file',
        input_file: { file_id: 'data:application/pdf;base64,filedata' },
      });
    });

    it('should correctly map images and files for Chat Completions API (Legacy/Non-GPT-5)', async () => {
      const provider = new OpenAIProvider('gpt-4o'); // Use model that doesn't trigger Responses API if possible
      mockCreateChatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'Hello', role: 'assistant' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const messages = [
        {
          role: MessageRole.USER,
          content: 'Legacy check',
          attachments: [
            { type: 'image' as const, base64: 'imgdata', mimeType: 'image/png' },
            { type: 'file' as const, base64: 'filedata', mimeType: 'text/plain', name: 'test.txt' },
          ],
        },
      ];

      await provider.call(messages);

      expect(mockCreateChatCompletion).toHaveBeenCalled();
      const params = mockCreateChatCompletion.mock.calls[0][0];
      const userMessage = params.messages[0];

      expect(userMessage.content).toHaveLength(3);
      expect(userMessage.content[1].type).toBe('image_url');
      expect(userMessage.content[2].type).toBe('input_file');
    });
  });

  describe('OpenRouterProvider', () => {
    it('should correctly map images and files for OpenRouter API', async () => {
      const provider = new OpenRouterProvider(OpenRouterModel.GEMINI_3_FLASH);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello', role: 'assistant' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const messages = [
        {
          role: MessageRole.USER,
          content: 'OpenRouter check',
          attachments: [
            { type: 'image' as const, base64: 'imgdata', mimeType: 'image/png' },
            {
              type: 'file' as const,
              base64: 'filedata',
              mimeType: 'application/pdf',
              name: 'doc.pdf',
            },
          ],
        },
      ];

      await provider.call(messages);

      expect(fetch).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      const userMessage = body.messages[0];

      expect(userMessage.content).toHaveLength(3);
      expect(userMessage.content[1].type).toBe('image_url');
      expect(userMessage.content[2].type).toBe('input_file');
    });
  });

  describe('BedrockProvider', () => {
    it('should correctly map images and files for Bedrock Converse API', async () => {
      const provider = new BedrockProvider(BedrockModel.CLAUDE_4_6);
      bedrockMock.on(ConverseCommand).resolves({
        output: { message: { content: [{ text: 'Hello' }], role: 'assistant' } },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });

      const messages = [
        {
          role: MessageRole.USER,
          content: 'Bedrock check',
          attachments: [
            { type: 'image' as const, base64: 'imgdata', mimeType: 'image/png' },
            {
              type: 'file' as const,
              base64: 'filedata',
              mimeType: 'application/pdf',
              name: 'test.pdf',
            },
          ],
        },
      ];

      await provider.call(messages);

      const calls = bedrockMock.commandCalls(ConverseCommand);
      const input = calls[0].args[0].input;
      const userMessage = input.messages![0];

      expect(userMessage.content).toHaveLength(3); // text + image + document
      expect(userMessage.content![0]).toHaveProperty('text');
      expect(userMessage.content![1]).toHaveProperty('image');
      expect(userMessage.content![2]).toHaveProperty('document');

      expect(userMessage.content![1].image!.format).toBe('png');
      expect(userMessage.content![2].document!.format).toBe('pdf');
      expect(userMessage.content![2].document!.name).toBe('test.pdf');
    });
  });
});
