import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    StagingBucket: { name: 'test-bucket' },
  },
}));
import { Agent } from './agent';
import { IMemory, IProvider, MessageRole } from './types/index';
import { AgentRegistry } from './registry';

const mockGetTraceId = vi.fn().mockReturnValue('test-trace-id');
const mockGetNodeId = vi.fn().mockReturnValue('test-node-id');
const mockGetParentId = vi.fn().mockReturnValue('test-parent-id');
const mockStartTrace = vi.fn().mockResolvedValue('test-trace-id');
const mockAddStep = vi.fn().mockResolvedValue(undefined);
const mockEndTrace = vi.fn().mockResolvedValue(undefined);

vi.mock('./registry', () => ({
  AgentRegistry: {
    getRawConfig: vi.fn(),
    recordToolUsage: vi.fn(),
  },
}));

vi.mock('./tracer', () => {
  return {
    ClawTracer: class {
      constructor() {}
      getTraceId = mockGetTraceId;
      getNodeId = mockGetNodeId;
      getParentId = mockGetParentId;
      startTrace = mockStartTrace;
      addStep = mockAddStep;
      endTrace = mockEndTrace;
    },
  };
});

describe('Agent Model Overrides', () => {
  let mockMemory: IMemory;
  let mockProvider: IProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      getHistory: vi.fn().mockResolvedValue([]),
      getDistilledMemory: vi.fn().mockResolvedValue(''),
      getLessons: vi.fn().mockResolvedValue([]),
      addMessage: vi.fn().mockResolvedValue(undefined),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
    } as unknown as IMemory;

    mockProvider = {
      call: vi.fn().mockResolvedValue({ role: MessageRole.ASSISTANT, content: 'Hello' }),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: ['standard', 'fast', 'thinking', 'deep'],
      }),
    } as unknown as IProvider;
  });

  it('should use global model overrides from AgentRegistry', async () => {
    vi.mocked(AgentRegistry.getRawConfig).mockImplementation(async (key: string) => {
      if (key === 'active_provider') return 'bedrock';
      if (key === 'active_model') return 'anthropic.claude-3-sonnet';
      return undefined;
    });

    const agent = new Agent(mockMemory, mockProvider, [], 'System', {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'System',
      model: 'gpt-4o', // Initial model
      provider: 'openai', // Initial provider
    });

    await agent.process('user-1', 'Hello');

    expect(mockProvider.call).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.any(String),
      'anthropic.claude-3-sonnet',
      'bedrock'
    );
  });

  it('should correctly trace the active model and provider in the llm_call step', async () => {
    vi.mocked(AgentRegistry.getRawConfig).mockImplementation(async (key: string) => {
      if (key === 'active_provider') return 'openrouter';
      if (key === 'active_model') return 'meta-llama/llama-3-70b-instruct';
      return undefined;
    });

    const agent = new Agent(mockMemory, mockProvider, [], 'System', {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'System',
    });

    await agent.process('user-1', 'Hello');

    expect(mockAddStep).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'llm_call',
        content: expect.objectContaining({
          model: 'meta-llama/llama-3-70b-instruct',
          provider: 'openrouter',
        }),
      })
    );
  });

  it('should correctly report the active model and provider when checkConfig tool is called', async () => {
    const { checkConfig } = await import('../tools/system');

    vi.mocked(AgentRegistry.getRawConfig).mockImplementation(async (key: string) => {
      if (key === 'active_provider') return 'openai';
      if (key === 'active_model') return 'gpt-4o';
      return undefined;
    });

    const mockTool = {
      name: 'checkConfig',
      description: 'Check Config',
      parameters: { type: 'object', properties: {} },
      execute: checkConfig.execute,
    };

    mockProvider.call = vi
      .fn()
      .mockResolvedValueOnce({
        role: MessageRole.ASSISTANT,
        content: '',
        tool_calls: [
          {
            id: 'call-config',
            type: 'function',
            function: { name: 'checkConfig', arguments: '{}' },
          },
        ],
      })
      .mockResolvedValueOnce({ role: MessageRole.ASSISTANT, content: 'Done' });

    const agent = new Agent(mockMemory, mockProvider, [mockTool], 'System', {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'System',
    });

    await agent.process('user-1', 'Check my config');

    // Find the tool result in memory or check what the provider was called with
    const lastCallHistory = vi.mocked(mockProvider.call).mock.calls.slice(-1)[0][0];
    const toolResult = lastCallHistory.find(
      (m) => m.role === MessageRole.TOOL && m.name === 'checkConfig'
    );

    expect(toolResult?.content).toContain('ACTIVE_PROVIDER: openai');
    expect(toolResult?.content).toContain('ACTIVE_MODEL: gpt-4o');
  });

  it('should call saveMemory tool when requested', async () => {
    const mockSaveMemory = {
      name: 'saveMemory',
      description: 'Save memory',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue('Saved successfully'),
    };

    mockProvider.call = vi
      .fn()
      .mockResolvedValueOnce({
        role: MessageRole.ASSISTANT,
        content: '',
        tool_calls: [
          {
            id: 'call-save',
            type: 'function',
            function: {
              name: 'saveMemory',
              arguments: JSON.stringify({ content: 'SuperPeng', category: 'user_preference' }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ role: MessageRole.ASSISTANT, content: 'Done' });

    const agent = new Agent(mockMemory, mockProvider, [mockSaveMemory], 'System', {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'System',
    });

    await agent.process('user-1', 'Call me SuperPeng');

    expect(mockSaveMemory.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'SuperPeng',
        category: 'user_preference',
      })
    );
  });
});
