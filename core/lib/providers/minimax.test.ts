import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MiniMaxProvider } from './minimax';
import { MessageRole, ReasoningProfile, ITool, Message } from '../types/index';

// Mock Anthropic SDK
const mockCreateMessage = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = {
        create: mockCreateMessage,
      };
    },
  };
});

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    MiniMaxApiKey: { value: 'test-minimax-key' },
  },
}));

vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('MiniMaxProvider', () => {
  let provider: MiniMaxProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new MiniMaxProvider();
  });

  it('should call MiniMax with correct parameters', async () => {
    mockCreateMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello from MiniMax' }],
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const messages: Message[] = [
      { role: MessageRole.SYSTEM, content: 'You are a helpful assistant' },
      { role: MessageRole.USER, content: 'Hi' },
    ];

    const response = await provider.call(messages);

    expect(mockCreateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'MiniMax-M2.7', // Default MiniMaxModel.M2_7 value
        system: 'You are a helpful assistant',
        messages: [{ role: 'user', content: 'Hi' }],
        thinking: {
          type: 'enabled',
          budget_tokens: 4000, // STANDARD profile
        },
      })
    );

    expect(response.content).toBe('Hello from MiniMax');
    expect(response.usage?.total_tokens).toBe(30);
  });

  it('should handle tools correctly', async () => {
    mockCreateMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'Calling tool' }],
    });

    const tools: ITool[] = [
      {
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: { location: { type: 'string' } } },
        execute: async () => 'sunny',
      },
    ];

    await provider.call([{ role: MessageRole.USER, content: 'Weather in Tokyo' }], tools);

    expect(mockCreateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            input_schema: { type: 'object', properties: { location: { type: 'string' } } },
          },
        ],
      })
    );
  });

  it('should handle thinking blocks in response', async () => {
    mockCreateMessage.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'I should say hello' },
        { type: 'text', text: 'Hello!' },
      ],
    });

    const response = await provider.call([{ role: MessageRole.USER, content: 'test' }]);

    expect(response.content).toBe('Hello!');
  });

  it('should handle assistant messages with tool calls', async () => {
    mockCreateMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'OK' }],
    });

    const messages: Message[] = [
      {
        role: MessageRole.ASSISTANT,
        content: 'I will help',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'test_tool', arguments: '{"arg": 1}' },
          },
        ],
      },
    ];

    await provider.call(messages);

    expect(mockCreateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'I will help' },
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'test_tool',
                input: { arg: 1 },
              },
            ],
          },
        ],
      })
    );
  });

  it('should handle tool result messages', async () => {
    mockCreateMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'Processed' }],
    });

    const messages: Message[] = [
      {
        role: MessageRole.TOOL,
        content: 'Tool output',
        tool_call_id: 'call_1',
      },
    ];

    await provider.call(messages);

    expect(mockCreateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_1',
                content: 'Tool output',
              },
            ],
          },
        ],
      })
    );
  });

  it('should use correct reasoning profile budget', async () => {
    mockCreateMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'Hi' }],
    });

    await provider.call([{ role: MessageRole.USER, content: 'test' }], [], ReasoningProfile.DEEP);

    expect(mockCreateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        thinking: {
          type: 'enabled',
          budget_tokens: 16000,
        },
      })
    );
  });

  it('should extract tool_calls from response blocks', async () => {
    mockCreateMessage.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'I need to use a tool' },
        {
          type: 'tool_use',
          id: 'call_123',
          name: 'save_memory',
          input: { content: 'test', category: 'fact' },
        },
      ],
      usage: { input_tokens: 50, output_tokens: 100 },
    });

    const response = await provider.call([{ role: MessageRole.USER, content: 'save this' }]);

    expect(response.tool_calls).toBeDefined();
    expect(response.tool_calls?.[0]).toEqual({
      id: 'call_123',
      type: 'function',
      function: {
        name: 'save_memory',
        arguments: '{"content":"test","category":"fact"}',
      },
    });
    expect(response.content).toBeUndefined();
  });

  it('should extract both text content and tool_calls', async () => {
    mockCreateMessage.mockResolvedValue({
      content: [
        { type: 'text', text: 'I will save that for you.' },
        {
          type: 'tool_use',
          id: 'call_456',
          name: 'save_memory',
          input: { content: 'test' },
        },
      ],
    });

    const response = await provider.call([{ role: MessageRole.USER, content: 'save this' }]);

    expect(response.content).toBe('I will save that for you.');
    expect(response.tool_calls?.[0].function.name).toBe('save_memory');
  });

  it('should report correct capabilities', async () => {
    const caps = await provider.getCapabilities();
    expect(caps.contextWindow).toBe(204800);
    expect(caps.supportedReasoningProfiles).toContain(ReasoningProfile.DEEP);
  });

  it('should include output_config when responseFormat is json_schema', async () => {
    mockCreateMessage.mockResolvedValue({
      content: [{ type: 'text', text: '{"name":"John"}' }],
    });

    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: {
        name: 'person',
        strict: true,
        schema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
    };

    await provider.call(
      [{ role: MessageRole.USER, content: 'extract person' }],
      [],
      ReasoningProfile.STANDARD,
      undefined,
      undefined,
      responseFormat
    );

    expect(mockCreateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        output_config: {
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        },
      })
    );
  });

  it('should not include output_config when responseFormat is not provided', async () => {
    mockCreateMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello' }],
    });

    await provider.call([{ role: MessageRole.USER, content: 'hi' }]);

    const callArgs = mockCreateMessage.mock.calls[0][0];
    expect(callArgs.output_config).toBeUndefined();
  });
});
