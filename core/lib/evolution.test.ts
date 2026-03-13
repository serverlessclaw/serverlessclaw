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

vi.mock('../tools/index', () => ({
  tools: {
    discoverSkills: {
      name: 'discoverSkills',
      description: 'Find skills',
      parameters: {},
      execute: vi.fn(),
    },
    installSkill: {
      name: 'installSkill',
      description: 'Install skill',
      parameters: {},
      execute: vi.fn(),
    },
    secretTool: {
      name: 'secretTool',
      description: 'A hidden capability',
      parameters: {},
      execute: vi.fn().mockResolvedValue('Secret used!'),
    },
  },
  getAgentTools: vi.fn(),
}));

// Mock Tracer
vi.mock('./tracer', () => ({
  ClawTracer: class {
    constructor() {}
    getTraceId = () => 't1';
    getNodeId = () => 'n1';
    getParentId = () => undefined;
    startTrace = vi.fn();
    addStep = vi.fn();
    endTrace = vi.fn();
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
      addMessage: vi.fn().mockResolvedValue(undefined),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
      searchInsights: vi.fn().mockResolvedValue([]),
      updateGapStatus: vi.fn().mockResolvedValue(undefined),
      getMessages: vi.fn().mockResolvedValue([]),
      setGap: vi.fn().mockResolvedValue(undefined),
      getAllGaps: vi.fn().mockResolvedValue([]),
      addLesson: vi.fn().mockResolvedValue(undefined),
    } as unknown as IMemory;
    mockProvider = {
      call: vi.fn(),
    } as unknown as IProvider;
  });

  it('should simulate an agent discovering and installing a new skill', async () => {
    const { tools, getAgentTools } = await import('../tools/index');

    // 1. Initial State: Agent only has discovery tools
    const initialTools = [tools.discoverSkills, tools.installSkill];
    vi.mocked(getAgentTools).mockResolvedValue(initialTools);

    const agent = new Agent(mockMemory, mockProvider, initialTools, 'System', {
      id: 'superclaw',
      name: 'SuperClaw',
      enabled: true,
      systemPrompt: 'System',
    });

    // 2. LLM decides to discover skills
    vi.mocked(mockProvider.call)
      .mockResolvedValueOnce({
        role: MessageRole.ASSISTANT,
        content: 'I need a secret tool.',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'discoverSkills', arguments: '{"query": "secret"}' },
          },
        ],
      })
      // 3. LLM decides to install the tool it found
      .mockResolvedValueOnce({
        role: MessageRole.ASSISTANT,
        content: 'Found it! Installing.',
        tool_calls: [
          {
            id: 'c2',
            type: 'function',
            function: { name: 'installSkill', arguments: '{"skillName": "secretTool"}' },
          },
        ],
      })
      // 4. LLM finally uses the installed tool
      .mockResolvedValueOnce({
        role: MessageRole.ASSISTANT,
        content: 'Now using the secret tool.',
        tool_calls: [
          { id: 'c3', type: 'function', function: { name: 'secretTool', arguments: '{}' } },
        ],
      })
      .mockResolvedValueOnce({ role: MessageRole.ASSISTANT, content: 'Task complete.' });

    // Mock the tool implementations
    vi.mocked(tools.discoverSkills.execute).mockResolvedValue('Found: secretTool');
    vi.mocked(tools.installSkill.execute).mockImplementation(async () => {
      // Simulate the registry update
      initialTools.push(tools.secretTool as ITool);
      return 'Installed.';
    });

    await agent.process('user-1', 'Use the secret tool', {});

    // Verify the sequence
    expect(tools.discoverSkills.execute).toHaveBeenCalled();
    expect(tools.installSkill.execute).toHaveBeenCalled();
    expect(tools.secretTool.execute).toHaveBeenCalled();
    expect(mockProvider.call).toHaveBeenCalled();
  });
});
