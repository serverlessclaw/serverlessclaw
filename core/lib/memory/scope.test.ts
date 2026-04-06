import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../agent';
import {
  IMemory,
  IProvider,
  MessageRole,
  ReasoningProfile,
  AttachmentType,
  AgentCategory,
} from '../types/index';

// Mock Tracer to avoid SST link errors in tests
vi.mock('../tracer', () => {
  return {
    ClawTracer: class {
      constructor() {}
      getTraceId = vi.fn().mockReturnValue('mock-trace-id');
      getNodeId = vi.fn().mockReturnValue('mock-node-id');
      getParentId = vi.fn().mockReturnValue('mock-parent-id');
      startTrace = vi.fn().mockResolvedValue('mock-trace-id');
      addStep = vi.fn().mockResolvedValue(undefined);
      endTrace = vi.fn().mockResolvedValue(undefined);
    },
  };
});

describe('Agent Memory Scoping', () => {
  let mockMemory: IMemory;
  let mockProvider: IProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      getHistory: vi.fn().mockResolvedValue([]),
      getDistilledMemory: vi.fn().mockResolvedValue('Some facts'),
      getLessons: vi.fn().mockResolvedValue([]),
      getGlobalLessons: vi.fn().mockResolvedValue([]),
      addMessage: vi.fn().mockResolvedValue(undefined),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      getSummary: vi.fn().mockResolvedValue(null),
    } as unknown as IMemory;

    mockProvider = {
      call: vi.fn().mockResolvedValue({
        role: MessageRole.ASSISTANT,
        content: 'Hello',
        traceId: 'test-trace',
        messageId: 'test-msg',
      }),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: [ReasoningProfile.STANDARD],
        supportedAttachmentTypes: [AttachmentType.IMAGE, AttachmentType.FILE],
      }),
    } as unknown as IProvider;
  });

  it('should use base user ID for distilled memory and lessons even if userId is session-prefixed', async () => {
    const agent = new Agent(mockMemory, mockProvider, [], 'System prompt', {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'System prompt',
      description: 'test-agent',
      category: AgentCategory.SYSTEM,
      icon: 'test',
      tools: [],
    });

    const sessionUserId = 'CONV#dashboard-user#session_123';
    const baseUserId = 'dashboard-user';

    await agent.process(sessionUserId, 'Who am I?');

    // Verify history uses the full session ID (storageId)
    expect(mockMemory.getHistory).toHaveBeenCalledWith(sessionUserId);

    // Verify distilled memory uses the base user ID
    expect(mockMemory.getDistilledMemory).toHaveBeenCalledWith(baseUserId);

    // Verify lessons use the base user ID
    expect(mockMemory.getLessons).toHaveBeenCalledWith(baseUserId);
  });

  it('should use raw userId if no CONV# prefix is present', async () => {
    const agent = new Agent(mockMemory, mockProvider, [], 'System prompt', {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'System prompt',
      description: 'test-agent',
      category: AgentCategory.SYSTEM,
      icon: 'test',
      tools: [],
    });

    const rawUserId = 'telegram-user-456';

    await agent.process(rawUserId, 'Hello');

    expect(mockMemory.getDistilledMemory).toHaveBeenCalledWith(rawUserId);
    expect(mockMemory.getLessons).toHaveBeenCalledWith(rawUserId);
  });
});
