import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai';
import { MessageRole, Message, ReasoningProfile, AttachmentType, ToolType } from '../types/index';
import { Resource } from 'sst';

// Mock OpenAI SDK
const mockCreateResponse = vi.fn();
const mockOpenAIConstructor = vi.fn();

vi.mock('openai', () => {
  class MockOpenAI {
    responses = {
      create: mockCreateResponse,
    };
    chat = {
      completions: {
        create: vi.fn(), // Should no longer be used
      },
    };

    constructor(options: { apiKey: string }) {
      mockOpenAIConstructor(options);
    }
  }

  return {
    default: MockOpenAI,
  };
});

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    OpenAIApiKey: { value: 'sk-resource-key' },
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

  const resetProviderClientCache = () => {
    (OpenAIProvider as unknown as { _client: unknown; _currentKey: string | null })._client = null;
    (OpenAIProvider as unknown as { _client: unknown; _currentKey: string | null })._currentKey =
      null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SST_SECRET_OpenAIApiKey;
    delete process.env.OPENAI_API_KEY;
    (Resource as unknown as { OpenAIApiKey?: { value?: string } }).OpenAIApiKey = {
      value: 'sk-resource-key',
    };
    resetProviderClientCache();
    provider = new OpenAIProvider('gpt-5.4');
  });

  describe('api key resolution guardrails', () => {
    it('should prioritize linked SST secret over OPENAI_API_KEY', async () => {
      process.env.OPENAI_API_KEY = 'sk-env-primary';
      (Resource as unknown as { OpenAIApiKey?: { value?: string } }).OpenAIApiKey = {
        value: 'sk-linked-primary',
      };

      mockCreateResponse.mockResolvedValue({ output_text: 'ok', output: [] });

      await provider.call([
        {
          role: MessageRole.USER,
          content: 'resolve-key',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ]);

      expect(mockOpenAIConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-linked-primary' })
      );
    });

    it('should use OPENAI_API_KEY when linked key is placeholder', async () => {
      process.env.OPENAI_API_KEY = 'sk-openai-env';
      (Resource as unknown as { OpenAIApiKey?: { value?: string } }).OpenAIApiKey = {
        value: 'dummy',
      };

      mockCreateResponse.mockResolvedValue({ output_text: 'ok', output: [] });

      await provider.call([
        {
          role: MessageRole.USER,
          content: 'resolve-env',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ]);

      expect(mockOpenAIConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-openai-env' })
      );
    });

    it('should use SST_SECRET_OpenAIApiKey when linked and OPENAI_API_KEY are placeholders', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.SST_SECRET_OpenAIApiKey = 'sk-sst-env';
      (Resource as unknown as { OpenAIApiKey?: { value?: string } }).OpenAIApiKey = {
        value: 'test',
      };

      mockCreateResponse.mockResolvedValue({ output_text: 'ok', output: [] });

      await provider.call([
        {
          role: MessageRole.USER,
          content: 'resolve-sst-env',
          traceId: 'test-trace',
          messageId: 'test-msg',
        },
      ]);

      expect(mockOpenAIConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-sst-env' })
      );
    });

    it('should reject whitespace-only keys and throw actionable configuration error', async () => {
      process.env.OPENAI_API_KEY = '   ';
      process.env.SST_SECRET_OpenAIApiKey = '\t\n';
      (Resource as unknown as { OpenAIApiKey?: { value?: string } }).OpenAIApiKey = {
        value: 'dummy',
      };

      await expect(
        provider.call([
          {
            role: MessageRole.USER,
            content: 'misconfigured',
            traceId: 'test-trace',
            messageId: 'test-msg',
          },
        ])
      ).rejects.toThrow(
        'OpenAI API key is not configured. Set SST_SECRET_OpenAIApiKey (preferred for make dev) or OPENAI_API_KEY.'
      );
    });

    it('should reject placeholder-only key combinations', async () => {
      process.env.OPENAI_API_KEY = 'test';
      process.env.SST_SECRET_OpenAIApiKey = 'test-key';
      (Resource as unknown as { OpenAIApiKey?: { value?: string } }).OpenAIApiKey = {
        value: 'dummy',
      };

      await expect(
        provider.call([
          {
            role: MessageRole.USER,
            content: 'placeholder-only',
            traceId: 'test-trace',
            messageId: 'test-msg',
          },
        ])
      ).rejects.toThrow('OpenAI API key is not configured');
    });
  });

  it('should fall back to SST secret env var when linked secret is a placeholder', async () => {
    process.env.SST_SECRET_OpenAIApiKey = 'sk-env-fallback';
    (Resource as unknown as { OpenAIApiKey?: { value?: string } }).OpenAIApiKey = {
      value: 'dummy',
    };

    mockCreateResponse.mockResolvedValue({
      output_text: 'Hello',
      output: [],
    });

    const freshProvider = new OpenAIProvider('gpt-5.4');

    await freshProvider.call([
      { role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' },
    ]);

    expect(mockOpenAIConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-env-fallback' })
    );
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

    // Mini model should not request unsupported xhigh reasoning effort.
    provider = new OpenAIProvider('gpt-5-mini');
    await provider.call(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      [],
      ReasoningProfile.DEEP,
      'gpt-5-mini'
    );

    expect(mockCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: { effort: 'high', summary: 'auto' },
      })
    );
  });

  it('should request reasoning.summary for GPT-5 thinking profile and surface summary as thought', async () => {
    mockCreateResponse.mockResolvedValue({
      output_text: 'Final answer',
      output: [
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Reasoning summary from model' }],
        },
      ],
    });

    const result = await provider.call(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      [],
      ReasoningProfile.THINKING,
      'gpt-5.4'
    );

    expect(mockCreateResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: expect.objectContaining({ effort: expect.any(String), summary: 'auto' }),
      })
    );
    expect(result.thought).toBe('Reasoning summary from model');
  });

  it('should retry call without reasoning.summary when unsupported', async () => {
    mockCreateResponse
      .mockRejectedValueOnce(new Error('Unknown parameter: reasoning.summary'))
      .mockResolvedValueOnce({ output_text: 'Fallback ok', output: [] });

    const result = await provider.call(
      [{ role: MessageRole.USER, content: 'test', traceId: 'test-trace', messageId: 'test-msg' }],
      [],
      ReasoningProfile.THINKING,
      'gpt-5.4'
    );

    expect(mockCreateResponse).toHaveBeenCalledTimes(2);
    expect(mockCreateResponse.mock.calls[0][0].reasoning.summary).toBe('auto');
    expect(mockCreateResponse.mock.calls[1][0].reasoning.summary).toBeUndefined();
    expect(result.content).toBe('Fallback ok');
  });
});
