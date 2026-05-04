import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentExecutor } from './executor';
import { MessageRole, ReasoningProfile, AttachmentType } from '../types/index';

vi.mock('../../handlers/events/cancellation-handler', () => ({
  isTaskCancelled: vi.fn().mockResolvedValue(false),
  handleTaskCancellation: vi.fn(),
}));

describe('AgentExecutor Token Tracking', () => {
  let mockProvider: any;
  let mockTracer: any;

  beforeEach(() => {
    mockProvider = {
      call: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: [ReasoningProfile.STANDARD],
        supportsStructuredOutput: true,
        supportedAttachmentTypes: [AttachmentType.IMAGE, AttachmentType.FILE],
      }),
    };

    mockTracer = {
      addStep: vi.fn().mockResolvedValue(undefined),
    };
  });

  const getDefaultOptions = (overrides: Record<string, any> = {}) => ({
    activeModel: 'gpt-4o',
    activeProvider: 'openai',
    activeProfile: ReasoningProfile.STANDARD,
    maxIterations: 5,
    tracer: mockTracer as any,
    traceId: 'trace-123',
    taskId: 'task-123',
    nodeId: 'node-1',
    currentInitiator: 'superclaw',
    depth: 0,
    userId: 'user-1',
    userText: 'test task',
    mainConversationId: 'conv-1',
    ...overrides,
  });

  it('should calculate total_tokens correctly and include it in LLM_RESPONSE trace step', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'test-agent', 'Test Agent');

    mockProvider.call.mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: 'Hello world',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15, // The model might return this, but our code should sum it too
      },
    });

    await executor.runLoop([], getDefaultOptions({ maxIterations: 1 }));

    // Verify trace step content
    const addStepCalls = mockTracer.addStep.mock.calls;
    const llmResponseCall = addStepCalls.find((call: any) => call[0].type === 'llm_response');

    expect(llmResponseCall).toBeDefined();
    const usage = llmResponseCall[0].content.usage;
    expect(usage.totalInputTokens).toBe(10);
    expect(usage.totalOutputTokens).toBe(5);
    expect(usage.total_tokens).toBe(15);
  });
});
