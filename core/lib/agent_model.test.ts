import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    StagingBucket: { name: 'test-bucket' },
  },
}));
import { Agent } from './agent';
import { IMemory, IProvider, MessageRole } from './types/index';
import { ConfigManager } from './registry/config';

const mockGetTraceId = vi.fn().mockReturnValue('test-trace-id');
const mockGetNodeId = vi.fn().mockReturnValue('test-node-id');
const mockGetParentId = vi.fn().mockReturnValue('test-parent-id');
const mockStartTrace = vi.fn().mockResolvedValue('test-trace-id');
const mockAddStep = vi.fn().mockResolvedValue(undefined);
const mockEndTrace = vi.fn().mockResolvedValue(undefined);

vi.mock('./registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    getTypedConfig: vi.fn(),
  },
}));

vi.mock('./registry', () => ({
  AgentRegistry: {
    recordToolUsage: vi.fn(),
  },
}));

// Use vi.hoisted to ensure mock is available for dynamic imports
const { MockClawTracer, MockAgentExecutorFactory } = vi.hoisted(() => {
  class MockClawTracer {
    getTraceId = mockGetTraceId;
    getNodeId = mockGetNodeId;
    getParentId = mockGetParentId;
    startTrace = mockStartTrace;
    addStep = mockAddStep;
    endTrace = mockEndTrace;
  }
  const mockRunLoop = vi.fn().mockImplementation(async function (
    this: any,
    messages: any,
    options: any
  ) {
    const { activeModel, activeProvider, tracer } = options || {};

    const provider = options?.provider ?? this?.provider;
    const tools = options?.tools ?? this?.tools;

    // Call provider
    const aiResponse = await provider.call(
      messages,
      tools,
      options?.activeProfile,
      activeModel,
      activeProvider,
      options?.responseFormat
    );

    // Add to messages so the next call sees it (essential for tool-heavy flows)
    messages.push(aiResponse);

    // Add tracer steps
    await tracer.addStep({
      type: 'llm_call',
      content: { model: activeModel, provider: activeProvider },
    });

    // Execute tools if present
    if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
      for (const toolCall of aiResponse.tool_calls) {
        const tool = tools.find((t: any) => t.name === toolCall.function.name);
        if (tool) {
          const args = JSON.parse(toolCall.function.arguments);
          const resultText = await tool.execute(args);
          messages.push({
            role: MessageRole.TOOL,
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: typeof resultText === 'string' ? resultText : JSON.stringify(resultText),
          });
        }
      }

      // In real executor this loops, in mock we call once more to get "final" response if tools were used
      const finalResponse = await provider.call(
        messages,
        tools,
        options?.activeProfile,
        activeModel,
        activeProvider,
        options?.responseFormat
      );
      return {
        responseText: finalResponse.content ?? 'Done',
        paused: false,
        attachments: [],
      };
    }

    return {
      responseText: aiResponse.content ?? 'Hello',
      paused: false,
      attachments: [],
    };
  });

  function MockAgentExecutorFactory(provider: any, tools: any, agentId: any, agentName: any) {
    return {
      provider,
      tools,
      agentId,
      agentName,
      runLoop: mockRunLoop.bind({ provider, tools, agentId, agentName }),
    };
  }

  return { MockClawTracer, MockAgentExecutorFactory };
});

vi.mock('./tracer', () => ({
  ClawTracer: MockClawTracer,
}));

vi.mock('./agent/context-manager', () => ({
  ContextManager: {
    getManagedContext: vi.fn().mockResolvedValue({ messages: [] }),
    needsSummarization: vi.fn().mockReturnValue(false),
    summarize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./agent/executor', () => ({
  AgentExecutor: MockAgentExecutorFactory,
  AGENT_DEFAULTS: { MAX_ITERATIONS: 5 },
  AGENT_LOG_MESSAGES: { RECOVERY_LOG_PREFIX: 'RECOVERY: ' },
}));

vi.mock('./agent/context', () => ({
  AgentContext: {
    getMemoryIndexBlock: vi.fn().mockReturnValue(''),
    getIdentityBlock: vi.fn().mockReturnValue(''),
  },
}));

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
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      getSummary: vi.fn().mockResolvedValue(null),
    } as unknown as IMemory;

    mockProvider = {
      call: vi.fn().mockResolvedValue({ role: MessageRole.ASSISTANT, content: 'Hello' }),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: ['standard', 'fast', 'thinking', 'deep'],
      }),
    } as unknown as IProvider;
  });

  it('should use global model overrides from AgentRegistry', async () => {
    vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key: string) => {
      if (key === 'active_provider') return 'bedrock';
      if (key === 'active_model') return 'anthropic.claude-4.6-sonnet';
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
      'anthropic.claude-4.6-sonnet',
      'bedrock',
      undefined
    );
  });

  it('should correctly trace the active model and provider in the llm_call step', async () => {
    vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key: string) => {
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
    vi.mocked(ConfigManager.getRawConfig).mockImplementation(async (key: string) => {
      if (key === 'active_provider') return 'openai';
      if (key === 'active_model') return 'gpt-4o';
      return undefined;
    });

    const mockCheckConfig = {
      name: 'checkConfig',
      description: 'Check Config',
      parameters: { type: 'object' as const, properties: {} },
      execute: vi.fn().mockResolvedValue('ACTIVE_PROVIDER: openai\nACTIVE_MODEL: gpt-4o'),
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

    const agent = new Agent(mockMemory, mockProvider, [mockCheckConfig], 'System', {
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
      parameters: { type: 'object' as const, properties: {} },
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
