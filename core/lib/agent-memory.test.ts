import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from './agent';
import {
  IMemory,
  IProvider,
  MessageRole,
  InsightCategory,
  ReasoningProfile,
  AttachmentType,
  AgentCategory,
} from './types/index';

// Mock ConfigManager
vi.mock('./registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    getTypedConfig: vi.fn(),
  },
}));

// Mock recursion-tracker to avoid budget issues
vi.mock('./recursion-tracker', () => ({
  isBudgetExceeded: vi.fn().mockResolvedValue(false),
}));

// Mock handoff to avoid being blocked
vi.mock('./handoff', () => ({
  isHumanTakingControl: vi.fn().mockResolvedValue(false),
}));

// Mock identity manager for permission checks
vi.mock('./session/identity', () => ({
  getIdentityManager: vi.fn().mockResolvedValue({
    getUser: vi.fn().mockResolvedValue({ role: 'admin' }),
    hasPermission: vi.fn().mockResolvedValue(true),
  }),
  Permission: { TASK_CREATE: 'task:create' },
}));

// Mock Tracer
vi.mock('./tracer', () => ({
  ClawTracer: class {
    startTrace = vi.fn().mockResolvedValue('mock-trace-id');
    addStep = vi.fn().mockResolvedValue(undefined);
    endTrace = vi.fn().mockResolvedValue(undefined);
    failTrace = vi.fn().mockResolvedValue(undefined);
    detectDrift = vi.fn().mockResolvedValue(undefined);
    getTraceId = () => 'mock-trace-id';
    getNodeId = () => 'mock-node-id';
    getParentId = () => undefined;
  },
}));

describe('Agent Memory Recall Regression', () => {
  let mockMemory: IMemory;
  let mockProvider: IProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      getHistory: vi.fn().mockResolvedValue([]),
      getDistilledMemory: vi.fn().mockResolvedValue('Distilled Fact'),
      getLessons: vi.fn().mockResolvedValue([]),
      getGlobalLessons: vi.fn().mockResolvedValue([]),
      addMessage: vi.fn().mockResolvedValue(undefined),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      getSummary: vi.fn().mockResolvedValue(null),
      updateSummary: vi.fn().mockResolvedValue(undefined),
      getScopedUserId: vi.fn().mockImplementation((uid, scope) => {
        const workspaceId = typeof scope === 'string' ? scope : scope?.workspaceId;
        return workspaceId ? `${uid}#${workspaceId}` : uid;
      }),
    } as unknown as IMemory;

    mockProvider = {
      call: vi.fn().mockResolvedValue({
        role: MessageRole.ASSISTANT,
        content: 'Response',
        traceId: 'test-trace',
        messageId: 'test-msg',
      }),
      stream: vi.fn().mockImplementation(async function* () {
        yield { type: 'chunk', content: 'Response' };
      }),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: [ReasoningProfile.STANDARD],
        supportedAttachmentTypes: [AttachmentType.IMAGE, AttachmentType.FILE],
      }),
    } as unknown as IProvider;
  });

  it('should load preferences with both USER# prefix and raw userId in process()', async () => {
    const userId = 'dashboard-user';
    const preferenceItem = {
      id: 'pref-0',
      timestamp: 123,
      type: 'MEMORY:USER_PREFERENCE',
      content: 'User likes dark mode',
      metadata: {
        category: InsightCategory.USER_PREFERENCE,
        confidence: 10,
        impact: 5,
        complexity: 1,
        risk: 1,
        urgency: 1,
        priority: 5,
      },
    };

    // Mock searchInsights to return a preference for the prefixed search
    vi.mocked(mockMemory.searchInsights).mockImplementation(async (...args: any[]) => {
      const queryOrUserId = args[0];
      if (typeof queryOrUserId === 'string' && queryOrUserId === `USER#${userId}`) {
        return { items: [preferenceItem] };
      }
      return { items: [] };
    });

    const agent = new Agent(mockMemory, mockProvider, [], {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'Base system prompt',
      description: 'test-agent',
      category: AgentCategory.SYSTEM,
      icon: 'test',
      tools: [],
    });

    await agent.process(userId, 'What do I like?');

    // 1. Verify search was called for both
    const searchCalls = vi.mocked(mockMemory.searchInsights).mock.calls;
    const searchScopes = searchCalls.map((c) => [c[0], c[1], c[2]]);
    expect(searchScopes).toEqual(
      expect.arrayContaining([
        [`USER#${userId}`, '*', InsightCategory.USER_PREFERENCE],
        [userId, '*', InsightCategory.USER_PREFERENCE],
      ])
    );

    // 2. Verify facts were injected into the provider call
    const calls = vi.mocked(mockProvider.call).mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const messages = calls[0][0] as any[];
    const systemPromptMessage = messages.find((m) => m.role === 'system')?.content || '';

    // 3. Verify [INTELLIGENCE] block exists and contains facts
    expect(systemPromptMessage).toContain('[INTELLIGENCE]');
    expect(systemPromptMessage).toContain('User likes dark mode');
    expect(systemPromptMessage).toContain('Distilled Fact');
  });

  it('should load preferences with both USER# prefix and raw userId in stream()', async () => {
    const userId = 'dashboard-user';
    const preferenceItem = {
      id: 'pref-1',
      timestamp: 123,
      type: 'MEMORY:USER_PREFERENCE',
      content: 'User name is SuperPeng',
      metadata: {
        category: InsightCategory.USER_PREFERENCE,
        confidence: 10,
        impact: 5,
        complexity: 1,
        risk: 1,
        urgency: 1,
        priority: 5,
      },
    };

    vi.mocked(mockMemory.searchInsights).mockImplementation(async (queryOrUserId) => {
      if (queryOrUserId === userId) {
        return { items: [preferenceItem] };
      }
      return { items: [] };
    });

    const agent = new Agent(mockMemory, mockProvider, [], {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'Base system prompt',
      description: 'test-agent',
      category: AgentCategory.SYSTEM,
      icon: 'test',
      tools: [],
    });

    const iterator = await agent.stream(userId, 'Who am I?');
    // Use the async iterator correctly
    const asyncIterator = iterator[Symbol.asyncIterator]();
    await asyncIterator.next();

    // Verify search was called for both
    const searchCalls = vi.mocked(mockMemory.searchInsights).mock.calls;
    const searchScopes = searchCalls.map((c) => [c[0], c[1], c[2]]);
    expect(searchScopes).toEqual(
      expect.arrayContaining([
        [`USER#${userId}`, '*', InsightCategory.USER_PREFERENCE],
        [userId, '*', InsightCategory.USER_PREFERENCE],
      ])
    );
  });

  it('should handle CONV# prefixed userId correctly', async () => {
    const prefixedId = 'CONV#dashboard-user#session-123';
    const baseUserId = 'dashboard-user';

    const agent = new Agent(mockMemory, mockProvider, [], {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'Base system prompt',
      description: 'test-agent',
      category: AgentCategory.SYSTEM,
      icon: 'test',
      tools: [],
    });

    await agent.process(prefixedId, 'Hello');

    // Should still use baseUserId for insights (may also be called for recovery)
    const distilledMemoryCalls = vi.mocked(mockMemory.getDistilledMemory).mock.calls;
    const userIdCall = distilledMemoryCalls.find((c) => c[0] === baseUserId);
    expect(userIdCall).toBeDefined();
    const searchCalls = vi.mocked(mockMemory.searchInsights).mock.calls;
    const searchScopes = searchCalls.map((c) => [c[0], c[1], c[2]]);
    expect(searchScopes).toEqual(
      expect.arrayContaining([[`USER#${baseUserId}`, '*', InsightCategory.USER_PREFERENCE]])
    );
  });
});
