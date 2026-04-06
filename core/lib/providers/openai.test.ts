import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai';
import { MessageRole, Message, ReasoningProfile, AttachmentType, ToolType } from '../types/index';

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

vi.mock('../constants', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    OPENAI: {
      ...actual.OPENAI,
      ROLES: {
        USER: 'user',
        ASSISTANT: 'assistant',
        DEVELOPER: 'developer',
      },
      ITEM_TYPES: {
        MESSAGE: 'message',
        FUNCTION_CALL: 'function_call',
        FUNCTION_CALL_OUTPUT: 'function_call_output',
      },
      CONTENT_TYPES: {
        INPUT_TEXT: 'input_text',
        INPUT_FILE: 'input_file',
        IMAGE_URL: 'image_url',
      },
      FUNCTION_TYPE: 'function',
      MCP_TYPE: 'mcp',
    },
  };
});

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
        type: ToolType.FUNCTION,
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'done',
        connectionProfile: [],
        requiresApproval: false,
        requiredPermissions: [],
      },
      {
        name: 'code_interpreter',
        description: 'Built-in python',
        type: ToolType.CODE_INTERPRETER,
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'done',
        connectionProfile: [],
        requiresApproval: false,
        requiredPermissions: [],
      },
    ];

    await provider.call(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      tools
    );

    expect(mockCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          expect.objectContaining({ type: 'function', name: 'local_tool' }),
          expect.objectContaining({ type: ToolType.CODE_INTERPRETER }),
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
        type: ToolType.MCP,
        parameters: { type: 'object' as const, properties: {} },
        execute: async () => 'done',
        connectionProfile: [],
        requiresApproval: false,
        requiredPermissions: [],
      },
    ];

    await provider.call(
      [
        {
          role: MessageRole.USER,
          content: 'list my files',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ],
      tools
    );

    expect(mockCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            type: ToolType.MCP,
            server_label: 'google_drive',
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
        traceId: 't1',
        messageId: 'm1',
        attachments: [
          {
            type: AttachmentType.FILE,
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

  it('should correctly format image attachments for the Responses API', async () => {
    mockCreateResponse.mockResolvedValue({
      output_text: 'I see an image',
      output: [],
    });

    const messages = [
      {
        role: MessageRole.USER,
        content: 'What is this?',
        traceId: 't1',
        messageId: 'm1',
        attachments: [
          {
            type: AttachmentType.IMAGE,
            name: 'photo.jpg',
            base64: 'base64-image-data',
            mimeType: 'image/jpeg',
          },
        ],
      },
    ];

    await provider.call(messages as Message[], []);

    expect(mockCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'image_url',
                image_url: { url: 'data:image/jpeg;base64,base64-image-data' },
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
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      [],
      undefined,
      undefined,
      undefined,
      responseFormat
    );

    expect(mockCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.objectContaining({
          format: expect.objectContaining({
            type: 'json_schema',
            name: 'test_schema',
            strict: true,
            schema: expect.objectContaining({ type: 'object' }),
          }),
        }),
      })
    );
  });

  it('should report correct capabilities including contextWindow', async () => {
    const caps = await provider.getCapabilities('gpt-5.4');
    expect(caps.contextWindow).toBe(128000);
    expect(caps.supportsStructuredOutput).toBe(true);
    expect(caps.supportedReasoningProfiles).toContain(ReasoningProfile.DEEP);
  });

  it('should cap reasoning effort for mini models', async () => {
    mockCreateResponse.mockResolvedValue({ output_text: 'Hi', output: [] });

    // Mini model should support xhigh based on current code
    provider = new OpenAIProvider('gpt-5.4-mini');
    await provider.call(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      [],
      ReasoningProfile.DEEP
    );

    expect(mockCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: { effort: 'xhigh' },
      })
    );
  });
});
