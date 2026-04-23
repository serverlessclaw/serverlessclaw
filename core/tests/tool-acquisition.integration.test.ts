import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../lib/agent';
import { SkillRegistry } from '../lib/skills';
import { AgentRegistry } from '../lib/registry';
import {
  IMemory,
  IProvider,
  MessageRole,
  AgentCategory,
  ReasoningProfile,
  AttachmentType,
} from '../lib/types/index';

const { mockAddStep, mockEndTrace, mockStartTrace } = vi.hoisted(() => ({
  mockAddStep: vi.fn(),
  mockEndTrace: vi.fn(),
  mockStartTrace: vi.fn().mockResolvedValue('test-trace-id'),
}));

vi.mock('../lib/tracer', () => ({
  ClawTracer: class {
    constructor() {}
    getTraceId = () => 'test-trace-id';
    getNodeId = () => 'test-node-id';
    getParentId = () => undefined;
    startTrace = mockStartTrace;
    addStep = mockAddStep;
    endTrace = mockEndTrace;
    failTrace = vi.fn();
    getChildTracer = () => new (this as any).constructor();
  },
}));

vi.mock('../lib/agent/tracer-init', () => ({
  initializeTracer: vi.fn().mockResolvedValue({
    tracer: {
      getTraceId: () => 'test-trace-id',
      getNodeId: () => 'test-node-id',
      getParentId: () => undefined,
      startTrace: mockStartTrace,
      addStep: mockAddStep,
      endTrace: mockEndTrace,
      failTrace: vi.fn(),
    },
    traceId: 'test-trace-id',
    baseUserId: 'user-1',
  }),
}));

vi.mock('../lib/safety/index', () => ({
  getSafetyEngine: () => ({
    evaluateAction: vi.fn().mockResolvedValue({
      allowed: true,
      requiresApproval: false,
      reason: 'Mocked allowed',
    }),
  }),
  getCircuitBreaker: () => ({
    canProceed: vi.fn().mockResolvedValue({ allowed: true }),
  }),
  getSemanticLoopDetector: () => ({
    check: vi.fn().mockReturnValue({ isLoop: false }),
  }),
  TrustManager: {
    recordFailure: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../lib/agent/warmup', () => ({
  triggerSmartWarmup: vi.fn(),
}));

vi.mock('../lib/agent/config-resolver', () => ({
  resolveAgentConfig: vi.fn().mockResolvedValue({
    activeModel: 'test-model',
    activeProvider: 'test-provider',
    activeProfile: 'standard',
  }),
}));

// Mock AgentRegistry
vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn(),
    saveRawConfig: vi.fn(),
    getRawConfig: vi.fn().mockResolvedValue({}),
    recordToolUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock ConfigManager
vi.mock('../lib/registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockResolvedValue({}),
    saveRawConfig: vi.fn().mockResolvedValue(undefined),
    getTypedConfig: vi.fn().mockResolvedValue(0),
  },
}));

// Mock the internal TOOLS registry used by SkillRegistry
vi.mock('../tools/index', () => ({
  TOOLS: {
    target_tool: {
      name: 'target_tool',
      description: 'A very specific target tool',
      parameters: {},
      execute: vi.fn(),
    },
  },
}));

describe('Tool Acquisition Integration', () => {
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
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      getSummary: vi.fn().mockResolvedValue(null),
      updateSummary: vi.fn().mockResolvedValue(undefined),
      getScopedUserId: vi.fn().mockImplementation((uid) => uid),
    } as unknown as IMemory;

    mockProvider = {
      call: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: [ReasoningProfile.STANDARD],
        supportedAttachmentTypes: [AttachmentType.IMAGE, AttachmentType.FILE],
      }),
    } as unknown as IProvider;
  });

  it('should autonomously discover and install a missing tool', async () => {
    // 1. Setup the "Skeleton" Agent (only has discovery/install tools)
    const agentConfig = {
      id: 'skeleton-agent',
      name: 'Skeleton',
      enabled: true,
      systemPrompt: 'You are a skeleton agent. If you lack a tool, use discoverSkills.',
      category: AgentCategory.SYSTEM,
      tools: ['discoverSkills', 'installSkill'],
    };

    vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValue(agentConfig as any);

    // 2. Define the discovery/install tools
    const discoverSkillsTool = {
      name: 'discoverSkills',
      description: 'Finds relevant skills',
      execute: async ({ query }: { query: string }) => {
        const results = await SkillRegistry.discoverSkills(query);
        return {
          text: JSON.stringify(results),
          images: [],
          metadata: {},
          ui_blocks: [],
        };
      },
    };

    const installSkillTool = {
      name: 'installSkill',
      description: 'Adds a tool to roster',
      execute: async ({ skillName, agentId }: { skillName: string; agentId: string }) => {
        await SkillRegistry.installSkill(agentId, skillName);
        return {
          text: `Successfully installed ${skillName}`,
          images: [],
          metadata: {},
          ui_blocks: [],
        };
      },
    };

    // 3. Mock the target tool we want to "discover"
    // (Already mocked in the hoisted vi.mock at top)
    let callCount = 0;
    mockProvider.call = vi.fn().mockImplementation(async (msgs) => {
      callCount++;
      console.log(`[TEST MOCK] Provider.call #${callCount} called with ${msgs.length} messages`);
      if (callCount === 1) {
        return {
          role: MessageRole.ASSISTANT,
          content: 'I need to find the target tool.',
          traceId: 'test-trace-id',
          messageId: 'msg-1',
          tool_calls: [
            {
              id: 'call-discover',
              type: 'function',
              function: { name: 'discoverSkills', arguments: '{"query": "target"}' },
            },
          ],
        };
      }
      if (callCount === 2) {
        return {
          role: MessageRole.ASSISTANT,
          content: 'Found the tool. Installing it now.',
          traceId: 'test-trace-id',
          messageId: 'msg-2',
          tool_calls: [
            {
              id: 'call-install',
              type: 'function',
              function: {
                name: 'installSkill',
                arguments: '{"skillName": "target_tool", "agentId": "skeleton-agent"}',
              },
            },
          ],
        };
      }
      return {
        role: MessageRole.ASSISTANT,
        content: 'I have installed the tool and am ready to use it.',
        traceId: 'test-trace-id',
        messageId: 'msg-3',
      };
    });

    const agent = new Agent(
      mockMemory,
      mockProvider,
      [discoverSkillsTool as any, installSkillTool as any],
      agentConfig as any
    );

    // 5. Execute the process
    const result = await agent.process('user-1', 'Please use the target tool.');

    // 6. Verify the sequence
    expect(mockProvider.call).toHaveBeenCalledTimes(3);

    // Verify discovery was called
    expect(mockAddStep).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_call',
        content: expect.objectContaining({ toolName: 'discoverSkills' }),
      })
    );

    // Verify installation was called
    expect(mockAddStep).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_call',
        content: expect.objectContaining({ toolName: 'installSkill' }),
      })
    );

    // Verify registry was updated (SkillRegistry calls AgentRegistry.saveRawConfig)
    expect(AgentRegistry.saveRawConfig).toHaveBeenCalledWith(
      'agent_tool_overrides',
      expect.objectContaining({
        'skeleton-agent': expect.arrayContaining(['target_tool']),
      })
    );

    expect(result.responseText).toContain('ready to use it');
  });
});
