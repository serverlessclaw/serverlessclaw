import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai';
import { MessageRole } from '../types/index';

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

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    OpenAIApiKey: { value: 'test-key' },
  },
}));

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider('gpt-5.4');
  });

  it('should correctly map different tool types for the Responses API', async () => {
    mockCreateResponse.mockResolvedValue({
      output_text: 'Hello',
      output: [],
    });

    const tools = [
      {
        name: 'local_tool',
        description: 'A local tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'done',
      },
      {
        name: 'code_interpreter',
        description: 'Built-in python',
        type: 'code_interpreter',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'done',
      },
    ];

    await provider.call([{ role: MessageRole.USER, content: 'test' }], tools);

    expect(mockCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          expect.objectContaining({ type: 'function', name: 'local_tool' }),
          expect.objectContaining({ type: 'code_interpreter' }),
        ],
      })
    );

    // Built-in tools should NOT have name/description/parameters in the OpenAI request for non-function types
    const builtInTool = mockCreateResponse.mock.calls[0][0].tools[1];
    expect(builtInTool.name).toBeUndefined();
  });

  it('should correctly format file attachments for the Responses API', async () => {
    mockCreateResponse.mockResolvedValue({
      output_text: 'Hello',
      output: [],
    });

    const messages = [
      {
        role: MessageRole.USER,
        content: 'Check this file',
        attachments: [
          {
            type: 'file',
            name: 'test.txt',
            base64: 'SGVsbG8gd29ybGQ=', // "Hello world"
            mimeType: 'text/plain',
          },
        ],
      },
    ];

    await provider.call(messages as any, []);

    expect(mockCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.arrayContaining([
          expect.objectContaining({
            type: 'message',
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({ type: 'input_text', text: 'Check this file' }),
              expect.objectContaining({
                type: 'input_file',
                file_data: 'SGVsbG8gd29ybGQ=',
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('should correctly map different tool types for Chat Completions API', async () => {
    mockCreateChatCompletion.mockResolvedValue({
      choices: [{ message: { content: 'Hello', role: 'assistant' } }],
    });

    // Use a model that doesn't trigger Responses API (if we had one, but gpt-5.4 currently does)
    // Let's force a non-reasoning model name for this test
    const legacyProvider = new OpenAIProvider('gpt-4');

    const tools = [
      {
        name: 'local_tool',
        description: 'A local tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'done',
      },
      {
        name: 'code_interpreter',
        description: 'Built-in python',
        type: 'code_interpreter',
        parameters: { type: 'object', properties: {} },
        execute: async () => 'done',
      },
    ];

    await legacyProvider.call([{ role: MessageRole.USER, content: 'test' }], tools);

    expect(mockCreateChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            type: 'function',
            function: expect.objectContaining({ name: 'local_tool' }),
          }),
          expect.objectContaining({ type: 'code_interpreter' }),
        ],
      })
    );
  });
});
