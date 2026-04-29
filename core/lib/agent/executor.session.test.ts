import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentExecutor } from './executor';
import { ReasoningProfile, MessageRole, AttachmentType } from '../types/index';
import { SessionStateManager } from '../session/session-state';
import { ClawTracer } from '../tracer';

vi.mock('../registry', () => ({
  AgentRegistry: {
    getRawConfig: vi.fn().mockResolvedValue(false),
    recordToolUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('AgentExecutor - Session Injection', () => {
  const mockProvider = {
    call: vi.fn().mockResolvedValue({ content: 'Final response', tool_calls: [] }),
    getCapabilities: vi.fn().mockResolvedValue({
      supportedReasoningProfiles: [ReasoningProfile.STANDARD],
      supportedAttachmentTypes: [AttachmentType.IMAGE, AttachmentType.FILE],
    }),
  };

  const mockTracer = {
    addStep: vi.fn().mockResolvedValue(undefined),
  } as unknown as ClawTracer;

  const mockSessionStateManager = {
    getPendingMessages: vi.fn().mockResolvedValue([]),
    clearPendingMessages: vi.fn().mockResolvedValue(undefined),
    renewProcessing: vi.fn().mockResolvedValue(true),
  } as unknown as SessionStateManager;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should inject pending messages and clear them', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'agent-1', 'TestAgent');

    // Setup pending messages
    const pendingMsg = { id: 'p1', content: 'Urgent update', timestamp: Date.now() + 1000 };
    vi.mocked(mockSessionStateManager.getPendingMessages).mockResolvedValueOnce([pendingMsg]);

    const messages = [
      {
        role: MessageRole.USER,
        content: 'Initial task',
        traceId: 'test-trace',
        messageId: 'test-msg',
      },
    ];

    await executor.runLoop(messages, {
      activeModel: 'gpt-4',
      activeProvider: 'openai',
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 5,
      tracer: mockTracer,
      traceId: 't1',
      taskId: 't1',
      nodeId: 'n1',
      parentId: undefined,
      currentInitiator: 'user',
      depth: 0,
      sessionId: 'sess-1',
      userId: 'u1',
      userText: 'Initial task',
      mainConversationId: 'u1',
      sessionStateManager: mockSessionStateManager,
    });

    // Verify injection
    expect(messages).toContainEqual(
      expect.objectContaining({
        role: MessageRole.USER,
        content: expect.stringContaining('Urgent update'),
      })
    );

    // Verify clearing
    expect(mockSessionStateManager.clearPendingMessages).toHaveBeenCalledWith(
      'sess-1',
      ['p1'],
      expect.any(Object)
    );
    // Verify renewal
    expect(mockSessionStateManager.renewProcessing).toHaveBeenCalledWith(
      'sess-1',
      'agent-1',
      expect.any(Object)
    );
  });

  it('should skip old pending messages to avoid duplicate injection', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'agent-1', 'TestAgent');

    // Create a message that is "old" (timestamp < executor's creation time)
    const oldMsg = { id: 'old-1', content: 'Old news', timestamp: Date.now() - 10000 };
    vi.mocked(mockSessionStateManager.getPendingMessages).mockResolvedValueOnce([oldMsg]);

    const messages = [
      {
        role: MessageRole.USER,
        content: 'Initial task',
        traceId: 'test-trace',
        messageId: 'test-msg',
      },
    ];

    await executor.runLoop(messages, {
      activeModel: 'gpt-4',
      activeProvider: 'openai',
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 5,
      tracer: mockTracer,
      traceId: 't1',
      taskId: 't1',
      nodeId: 'n1',
      parentId: undefined,
      currentInitiator: 'user',
      depth: 0,
      sessionId: 'sess-1',
      userId: 'u1',
      userText: 'Initial task',
      mainConversationId: 'u1',
      sessionStateManager: mockSessionStateManager,
    });

    // Verify OLD message was NOT injected
    const injected = messages.some((m) => m.content?.includes('Old news'));
    expect(injected).toBe(false);
  });

  it('should handle multiple injections across iterations', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'agent-1', 'TestAgent');

    // Iteration 1: inject p1
    const p1 = { id: 'p1', content: 'Update 1', timestamp: Date.now() + 1000 };
    // Iteration 2: inject p2
    const p2 = { id: 'p2', content: 'Update 2', timestamp: Date.now() + 2000 };

    vi.mocked(mockSessionStateManager.getPendingMessages)
      .mockResolvedValueOnce([p1])
      .mockResolvedValueOnce([p2])
      .mockResolvedValue([]);

    // Make provider return a tool call to force multiple iterations
    vi.mocked(mockProvider.call)
      .mockResolvedValueOnce({
        content: 'thinking',
        tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'test', arguments: '{}' } }],
      })
      .mockResolvedValueOnce({ content: 'final' });

    const messages = [
      {
        role: MessageRole.USER,
        content: 'Initial task',
        traceId: 'test-trace',
        messageId: 'test-msg',
      },
    ];

    await executor.runLoop(messages, {
      activeModel: 'gpt-4',
      activeProvider: 'openai',
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 5,
      tracer: mockTracer,
      traceId: 't1',
      taskId: 't1',
      nodeId: 'n1',
      parentId: undefined,
      currentInitiator: 'user',
      depth: 0,
      sessionId: 'sess-1',
      userId: 'u1',
      userText: 'Initial task',
      mainConversationId: 'u1',
      sessionStateManager: mockSessionStateManager,
    });

    // Check p1 and p2 both injected
    expect(messages.some((m) => m.content?.includes('Update 1'))).toBe(true);
    expect(messages.some((m) => m.content?.includes('Update 2'))).toBe(true);

    // Verify clear was called for both
    expect(mockSessionStateManager.clearPendingMessages).toHaveBeenCalledWith(
      'sess-1',
      ['p1'],
      expect.any(Object)
    );
    expect(mockSessionStateManager.clearPendingMessages).toHaveBeenCalledWith(
      'sess-1',
      ['p2'],
      expect.any(Object)
    );
  });
});
