import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentExecutor } from './executor';
import { MessageRole, ReasoningProfile } from '../types/index';

describe('AgentExecutor', () => {
  let mockProvider: any;
  let mockTracer: any;

  beforeEach(() => {
    mockProvider = {
      call: vi.fn(),
      getCapabilities: vi.fn().mockResolvedValue({
        supportedReasoningProfiles: [ReasoningProfile.STANDARD],
        supportsStructuredOutput: true,
      }),
    };

    mockTracer = {
      addStep: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('should strip TASK_PAUSED prefix and Trace ID suffix from responseText', async () => {
    const mockTool = {
      name: 'pauseTool',
      description: 'A tool that pauses',
      parameters: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue('TASK_PAUSED: I am pausing now (Trace: trace-123).'),
    };

    const executorWithTool = new AgentExecutor(
      mockProvider as any,
      [mockTool as any],
      'test-agent',
      'Test Agent'
    );

    mockProvider.call.mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: '',
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'pauseTool', arguments: '{}' },
        },
      ],
    });

    const result = await executorWithTool.runLoop([], {
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 5,
      tracer: mockTracer as any,
      traceId: 'trace-123',
      nodeId: 'node-1',
      parentId: undefined,
      currentInitiator: 'main',
      depth: 0,
      userId: 'user-1',
      userText: 'pause me',
      mainConversationId: 'conv-1',
    });

    expect(result.paused).toBe(true);
    expect(result.responseText).toBe('I am pausing now');
    expect(result.pauseMessage).toBe('TASK_PAUSED: I am pausing now (Trace: trace-123).');
  });

  it('should handle responses with only TASK_PAUSED prefix', async () => {
    // Test private method via any cast or just trust the integration test above
    // Here we'll do another integration-style test for variety
    const mockTool = {
      name: 'simplePause',
      execute: vi.fn().mockResolvedValue('TASK_PAUSED: Just wait.'),
    };

    const executorWithTool = new AgentExecutor(
      mockProvider as any,
      [mockTool as any],
      'test-agent',
      'Test Agent'
    );
    mockProvider.call.mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: '',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'simplePause', arguments: '{}' } },
      ],
    });

    const result = await executorWithTool.runLoop([], {
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 5,
      tracer: mockTracer as any,
      traceId: 't1',
      nodeId: 'n1',
      parentId: undefined,
      currentInitiator: 'main',
      depth: 0,
      userId: 'u1',
      userText: 'wait',
      mainConversationId: 'c1',
    });

    expect(result.responseText).toBe('Just wait.');
  });
});
