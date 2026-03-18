import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai';
import { MessageRole, Message } from '../types/index';

// Mock OpenAI SDK
const mockCreateResponse = vi.fn();

vi.mock('openai', () => {
  return {
    default: class {
      responses = {
        create: mockCreateResponse,
      };
      chat = {
        completions: {
          create: vi.fn(), // Should no longer be used
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
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'done',
      },
      {
        name: 'code_interpreter',
        description: 'Built-in python',
        type: 'code_interpreter',
        parameters: { type: 'object' as const, properties: {} },
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
  });

  it('should correctly map managed connector (MCP) tools for the Responses API', async () => {
    mockCreateResponse.mockResolvedValue({
      output_text: 'Hello from Google Drive',
      output: [],
    });

    const tools = [
      {
        name: 'google_drive',
        description: 'Access Google Drive',
        connector_id: 'connector_googledrive',
        type: 'mcp' as const,
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'done',
      },
    ];

    await provider.call([{ role: MessageRole.USER, content: 'list my files' }], tools);

    expect(mockCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            type: 'mcp',
            name: 'google_drive',
            connector_id: 'connector_googledrive',
          }),
        ],
      })
    );
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

    await provider.call(messages as Message[], []);

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
                filename: 'test.txt',
                file_data: 'data:text/plain;base64,SGVsbG8gd29ybGQ=',
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('should include responseFormat in the Responses API call', async () => {
    mockCreateResponse.mockResolvedValue({
      output_text: '{"status": "SUCCESS"}',
      output: [],
    });

    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: {
        name: 'test_schema',
        strict: true,
        schema: { type: 'object', properties: { status: { type: 'string' } } },
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

    expect(mockCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: responseFormat,
      })
    );
  });
});
