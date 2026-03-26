import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from './agent';
import { MessageRole, IMemory, IProvider, ITool } from './types/index';

// Mock SST
vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
  },
}));

// Mock EventBridge
vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: class {
    send = vi.fn().mockResolvedValue({});
  },
  PutEventsCommand: class {
    constructor(public input: unknown) {}
  },
}));

// Comprehensive mock setup
vi.mock('./registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn(),
    getRawConfig: vi.fn().mockResolvedValue({}),
    saveRawConfig: vi.fn(),
    recordToolUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

// Use vi.hoisted to ensure mock is available for dynamic imports
const { MockClawTracer, MockAgentExecutor } = vi.hoisted(() => {
  const mockRunLoop = vi.fn().mockImplementation(async (messages: any, options: any) => {
    const { provider, tools, tracer } = options || {};

    const resp = await provider.call(messages, tools);
    messages.push(resp);

    if (tracer?.addStep) {
      await tracer.addStep({ type: 'llm_call', content: { model: options?.activeModel } });
    }

    if (resp.tool_calls && resp.tool_calls.length > 0) {
      for (const tc of resp.tool_calls) {
        const tool = (tools || []).find((t: any) => t.name === tc.function.name);
        if (tool) {
          const args =
            typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
          await tool.execute(args);
        }
      }
    }
    return { responseText: resp.content || 'Done', paused: false, attachments: [] };
  });

  class MockAgentExecutor {
    constructor(
      public provider: any,
      public tools: any,
      public agentId: any,
      public agentName: any
    ) {}
    runLoop(msgs: any, opts: any) {
      return mockRunLoop(msgs, { ...opts, provider: this.provider, tools: this.tools });
    }
  }

  class MockClawTracer {
    getTraceId = () => 't1';
    getNodeId = () => 'n1';
    getParentId = () => undefined;
    addStep = vi.fn();
    startTrace = vi.fn();
    endTrace = vi.fn();
  }

  return { MockClawTracer, MockAgentExecutor };
});

vi.mock('./tracer', () => ({
  ClawTracer: MockClawTracer,
}));

vi.mock('./agent/context-manager', () => ({
  ContextManager: {
    getManagedContext: vi.fn().mockResolvedValue({
      messages: [{ role: 'user', content: 'Use the test tool' }],
      totalTokens: 100,
    }),
    needsSummarization: vi.fn().mockReturnValue(false),
    summarize: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./agent/executor', () => ({
  AgentExecutor: MockAgentExecutor,
  AGENT_DEFAULTS: { MAX_ITERATIONS: 5 },
  AGENT_LOG_MESSAGES: { RECOVERY_LOG_PREFIX: 'RECOVERY: ' },
}));

vi.mock('./agent/context', () => ({
  AgentContext: {
    getMemoryIndexBlock: vi.fn().mockReturnValue(''),
    getIdentityBlock: vi.fn().mockReturnValue(''),
  },
}));

describe('Agent Evolution Flow', () => {
  let mockMemory: IMemory;
  let mockProvider: IProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      getHistory: vi.fn().mockResolvedValue([]),
      getDistilledMemory: vi.fn().mockResolvedValue(''),
      getLessons: vi.fn().mockResolvedValue([]),
      getGlobalLessons: vi.fn().mockResolvedValue([]),
      addMessage: vi.fn().mockResolvedValue(undefined),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
      searchInsights: vi.fn().mockResolvedValue([]),
      updateGapStatus: vi.fn().mockResolvedValue(undefined),
      getMessages: vi.fn().mockResolvedValue([]),
      setGap: vi.fn().mockResolvedValue(undefined),
      getAllGaps: vi.fn().mockResolvedValue([]),
      addLesson: vi.fn().mockResolvedValue(undefined),
      getSummary: vi.fn().mockResolvedValue(null),
    } as unknown as IMemory;
    mockProvider = {
      call: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: [],
        contextWindow: 10000,
      }),
    } as unknown as IProvider;
  });

  it('should simulate an agent using a tool and getting a result', async () => {
    const mockTool: ITool = {
      name: 'testTool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue('Tool executed successfully!'),
    };

    const agent = new Agent(mockMemory, mockProvider, [mockTool], 'System', {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'System',
    });

    // LLM decides to use the tool
    vi.mocked(mockProvider.call)
      .mockResolvedValueOnce({
        role: MessageRole.ASSISTANT,
        content: 'I will use the test tool.',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'testTool', arguments: '{}' },
          },
        ],
      })
      .mockResolvedValueOnce({
        role: MessageRole.ASSISTANT,
        content: 'Tool execution complete.',
      });

    await agent.process('user-1', 'Use the test tool', {});

    // Verify the tool was executed
    expect(mockTool.execute).toHaveBeenCalled();
    expect(mockProvider.call).toHaveBeenCalled();
  });
});
