import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from './agent';
import { IMemory, IProvider, MessageRole, InsightCategory } from './types/index';

// Mock ConfigManager
vi.mock('./registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    getTypedConfig: vi.fn(),
  },
}));

// Mock Tracer
vi.mock('./tracer', () => ({
  ClawTracer: class {
    startTrace = vi.fn().mockResolvedValue('mock-trace-id');
    addStep = vi.fn().mockResolvedValue(undefined);
    endTrace = vi.fn().mockResolvedValue(undefined);
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
    } as unknown as IMemory;

    mockProvider = {
      call: vi.fn().mockResolvedValue({ role: MessageRole.ASSISTANT, content: 'Response' }),
      stream: vi.fn().mockImplementation(async function* () {
        yield { type: 'chunk', content: 'Response' };
      }),
      getCapabilities: vi
        .fn()
        .mockResolvedValue({ supportedReasoningProfiles: ['standard'], contextWindow: 100000 }),
    } as unknown as IProvider;
  });

  it('should load preferences with both USER# prefix and raw userId in process()', async () => {
    const userId = 'dashboard-user';
    const preferenceItem = {
      id: 'pref-0',
      timestamp: Date.now(),
      content: 'User prefers dark mode',
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
    vi.mocked(mockMemory.searchInsights).mockImplementation(async (scopeId) => {
      if (scopeId === `USER#${userId}`) {
        return { items: [preferenceItem] };
      }
      return { items: [] };
    });

    const agent = new Agent(mockMemory, mockProvider, [], 'System prompt', {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'Base system prompt',
    });

    await agent.process(userId, 'What do I like?');

    // 1. Verify search was called for both
    expect(mockMemory.searchInsights).toHaveBeenCalledWith(
      `USER#${userId}`,
      '*',
      InsightCategory.USER_PREFERENCE
    );
    expect(mockMemory.searchInsights).toHaveBeenCalledWith(
      userId,
      '*',
      InsightCategory.USER_PREFERENCE
    );

    // 2. Verify facts were injected into the provider call
    const calls = vi.mocked(mockProvider.call).mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const messages = calls[0][0] as any[];
    const systemPromptMessage = messages.find((m) => m.role === 'system')?.content || '';

    // 3. Verify [INTELLIGENCE] block exists and contains facts
    expect(systemPromptMessage).toContain('[INTELLIGENCE]');
    expect(systemPromptMessage).toContain('User prefers dark mode');
    expect(systemPromptMessage).toContain('Distilled Fact');
  });

  it('should load preferences with both USER# prefix and raw userId in stream()', async () => {
    const userId = 'dashboard-user';
    const preferenceItem = {
      id: 'pref-1',
      timestamp: Date.now(),
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

    vi.mocked(mockMemory.searchInsights).mockImplementation(async (scopeId) => {
      if (scopeId === userId) {
        return { items: [preferenceItem] };
      }
      return { items: [] };
    });

    const agent = new Agent(mockMemory, mockProvider, [], 'System prompt', {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'Base system prompt',
    });

    const iterator = await agent.stream(userId, 'Who am I?');
    // Use the async iterator correctly
    const asyncIterator = iterator[Symbol.asyncIterator]();
    await asyncIterator.next();

    // Verify search was called for both
    expect(mockMemory.searchInsights).toHaveBeenCalledWith(
      `USER#${userId}`,
      '*',
      InsightCategory.USER_PREFERENCE
    );
    expect(mockMemory.searchInsights).toHaveBeenCalledWith(
      userId,
      '*',
      InsightCategory.USER_PREFERENCE
    );
  });

  it('should handle CONV# prefixed userId correctly', async () => {
    const prefixedId = 'CONV#dashboard-user#session-123';
    const baseUserId = 'dashboard-user';

    const agent = new Agent(mockMemory, mockProvider, [], 'System prompt', {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'Base system prompt',
    });

    await agent.process(prefixedId, 'Hello');

    // Should still use baseUserId for insights
    expect(mockMemory.getDistilledMemory).toHaveBeenCalledWith(baseUserId);
    expect(mockMemory.searchInsights).toHaveBeenCalledWith(
      `USER#${baseUserId}`,
      '*',
      InsightCategory.USER_PREFERENCE
    );
    expect(mockMemory.searchInsights).toHaveBeenCalledWith(
      baseUserId,
      '*',
      InsightCategory.USER_PREFERENCE
    );
  });
});
