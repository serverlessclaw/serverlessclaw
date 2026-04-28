import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '../agent';
import { IMemory, IProvider, MessageRole, ReasoningProfile } from '../types';

// Mock tracer
const mockTracer = {
  getNodeId: vi.fn().mockReturnValue('node-123'),
  getParentId: vi.fn().mockReturnValue('parent-123'),
  endTrace: vi.fn().mockResolvedValue(undefined),
  failTrace: vi.fn().mockResolvedValue(undefined),
  addStep: vi.fn().mockResolvedValue(undefined),
  startTrace: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../agent/tracer-init', () => ({
  initializeTracer: vi.fn().mockImplementation(async (userId) => ({
    tracer: mockTracer,
    traceId: 'mock-trace-id',
    baseUserId: userId.replace('CONV#', '').split('#')[0],
  })),
}));

vi.mock('../recursion-tracker', () => ({
  isBudgetExceeded: vi.fn().mockResolvedValue(false),
}));

vi.mock('../handoff', () => ({
  isHumanTakingControl: vi.fn().mockResolvedValue(false),
}));

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getTypedConfig: vi.fn().mockResolvedValue(0),
    getRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../session/identity', () => ({
  getIdentityManager: vi.fn().mockResolvedValue({
    getUser: vi.fn().mockResolvedValue({ role: 'admin' }),
    hasPermission: vi.fn().mockResolvedValue(true),
  }),
  Permission: { TASK_CREATE: 'task:create' },
}));

describe('Agent Memory Scoping', () => {
  let mockMemory: IMemory;
  let mockProvider: IProvider;

  beforeEach(() => {
    mockMemory = {
      getHistory: vi.fn().mockResolvedValue([]),
      addMessage: vi.fn().mockResolvedValue(undefined),
      getDistilledMemory: vi.fn().mockResolvedValue(''),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
      getLessons: vi.fn().mockResolvedValue([]),
      getSummary: vi.fn().mockResolvedValue(null),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      getGlobalLessons: vi.fn().mockResolvedValue([]),
      getScopedUserId: vi.fn().mockImplementation((id) => id),
    } as unknown as IMemory;

    mockProvider = {
      getCapabilities: vi.fn().mockResolvedValue({
        contextWindow: 100000,
        supportedAttachmentTypes: [],
        supportedReasoningProfiles: [ReasoningProfile.STANDARD],
      }),
      call: vi.fn().mockResolvedValue({
        role: MessageRole.ASSISTANT,
        content: 'I am an AI assistant.',
        traceId: 'mock-trace-id',
        messageId: 'msg-123',
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    } as unknown as IProvider;

    vi.clearAllMocks();
  });

  it('should use base user ID for distilled memory and lessons even if userId is session-prefixed', async () => {
    const sessionUserId = 'CONV#dashboard-user#session_123';
    const baseUserId = 'dashboard-user';

    const agent = new Agent(mockMemory, mockProvider, [], {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are helpful.',
    });

    await agent.process(sessionUserId, 'Who am I?');

    // Verify history uses the full session ID (storageId)
    expect(mockMemory.addMessage).toHaveBeenCalled();
    expect(mockMemory.getHistory).toHaveBeenCalledWith(sessionUserId);

    // Verify distilled memory uses the base user ID
    expect(mockMemory.getDistilledMemory).toHaveBeenCalledWith(baseUserId);
    expect(mockMemory.getLessons).toHaveBeenCalledWith(baseUserId);
  });

  it('should use raw userId if no CONV# prefix is present', async () => {
    const rawUserId = 'telegram-user-456';

    const agent = new Agent(mockMemory, mockProvider, [], {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are helpful.',
    });

    await agent.process(rawUserId, 'Hello');

    expect(mockMemory.getDistilledMemory).toHaveBeenCalledWith(rawUserId);
    expect(mockMemory.getLessons).toHaveBeenCalledWith(rawUserId);
  });
});
