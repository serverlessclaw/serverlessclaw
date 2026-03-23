import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentExecutor } from './executor';
import { MessageRole, ReasoningProfile } from '../types/index';

vi.mock('../../handlers/events/cancellation-handler', () => ({
  isTaskCancelled: vi.fn().mockResolvedValue(false),
  handleTaskCancellation: vi.fn(),
}));

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
      taskId: 'trace-123',
      nodeId: 'node-1',
      parentId: undefined,
      currentInitiator: 'superclaw',
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
      taskId: 't1',
      nodeId: 'n1',
      parentId: undefined,
      currentInitiator: 'superclaw',
      depth: 0,
      userId: 'u1',
      userText: 'wait',
      mainConversationId: 'c1',
    });

    expect(result.responseText).toBe('Just wait.');
  });

  it('should not overwrite tool arguments with system context', async () => {
    const mockTool = {
      name: 'dispatchTask',
      execute: vi.fn().mockImplementation((args) => {
        return `SUCCESS: dispatched to ${args.agentId} with task: ${args.task}`;
      }),
    };

    const executorWithTool = new AgentExecutor(
      mockProvider as any,
      [mockTool as any],
      'main-agent',
      'Main Agent'
    );

    mockProvider.call.mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: '',
      tool_calls: [
        {
          id: 'call-dispatch',
          type: 'function',
          function: {
            name: 'dispatchTask',
            arguments: JSON.stringify({
              agentId: 'special-agent',
              task: 'sub-task content',
            }),
          },
        },
      ],
    });

    await executorWithTool.runLoop([], {
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 1,
      tracer: mockTracer as any,
      traceId: 't-123',
      taskId: 't-123',
      nodeId: 'n-1',
      parentId: undefined,
      currentInitiator: 'superclaw',
      depth: 0,
      userId: 'u-1',
      userText: 'original user query',
      mainConversationId: 'c-1',
    });

    // The result should contain the arguments provided by the LLM, not the ones from system context
    expect(mockTool.execute).toHaveBeenCalled();
    const callArgs = (mockTool.execute as any).mock.calls[0][0];
    expect(callArgs.agentId).toBe('special-agent'); // Not 'main-agent'
    expect(callArgs.task).toBe('sub-task content'); // Not 'original user query'
    expect(callArgs.executorAgentId).toBe('main-agent'); // New prefixed field
    expect(callArgs.originalUserTask).toBe('original user query'); // New prefixed field
  });

  it('should allow SuperClaw (superclaw) to dispatch to strategic-planner without collision', async () => {
    // Mimic the real dispatchTask implementation's check
    const mockDispatchTask = {
      name: 'dispatchTask',
      execute: vi.fn().mockImplementation(async (args) => {
        if (args.agentId === 'superclaw') {
          return 'FAILED: Cannot dispatch to superclaw';
        }
        return `SUCCESS: dispatched to ${args.agentId}`;
      }),
    };

    const executor = new AgentExecutor(
      mockProvider as any,
      [mockDispatchTask as any],
      'superclaw',
      'SuperClaw'
    );

    mockProvider.call.mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: 'I am consulting the Strategic Planner...',
      tool_calls: [
        {
          id: 'call-123',
          type: 'function',
          function: {
            name: 'dispatchTask',
            arguments: JSON.stringify({
              agentId: 'strategic-planner',
              task: 'How many agents?',
              metadata: {},
            }),
          },
        },
      ],
    });

    await executor.runLoop([], {
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 1,
      tracer: mockTracer as any,
      traceId: 'trace-abc',
      taskId: 'trace-abc',
      nodeId: 'node-1',
      parentId: undefined,
      currentInitiator: 'superclaw',
      depth: 0,
      userId: 'user-789',
      userText: 'How many agents do we have?',
      mainConversationId: 'session-123',
    });

    // Verify it SUCCEEDED (did not receive the 'FAILED: Cannot dispatch to main' message)
    expect(mockDispatchTask.execute).toHaveBeenCalled();
    const resultText = (mockDispatchTask.execute as any).mock.results[0].value;
    expect(await resultText).toBe('SUCCESS: dispatched to strategic-planner');

    // Check that we also have the executor context available under safe names
    const finalArgs = (mockDispatchTask.execute as any).mock.calls[0][0];
    expect(finalArgs.executorAgentId).toBe('superclaw');
    expect(finalArgs.initiatorId).toBe('superclaw');
    expect(finalArgs.originalUserTask).toBe('How many agents do we have?');
  });

  it('should abort and return TASK_CANCELLED if task is marked as cancelled', async () => {
    const { isTaskCancelled } = await import('../../handlers/events/cancellation-handler');
    vi.mocked(isTaskCancelled).mockImplementation(async (taskId) => taskId === 'task-to-cancel');

    const executor = new AgentExecutor(mockProvider as any, [], 'agent-1', 'Agent 1');

    const result = await executor.runLoop([], {
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 5,
      tracer: mockTracer as any,
      traceId: 'trace-cancel',
      taskId: 'task-to-cancel',
      nodeId: 'node-1',
      parentId: undefined,
      currentInitiator: 'superclaw',
      depth: 0,
      userId: 'user-1',
      userText: 'work',
      mainConversationId: 'session-1',
    });

    expect(result.responseText).toContain('TASK_CANCELLED');
    expect(mockProvider.call).not.toHaveBeenCalled();
  });

  it('should return tool_calls in the final result', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'test', 'Test');
    mockProvider.call.mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: 'Here are some tools',
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 't1', arguments: '{}' } }],
    });

    const result = await executor.runLoop([], {
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 1,
      tracer: mockTracer as any,
      traceId: 't1',
      taskId: 't1',
      nodeId: 'n1',
      parentId: undefined,
      currentInitiator: 'superclaw',
      depth: 0,
      userId: 'u1',
      userText: 'test',
      mainConversationId: 'c1',
    });

    if (!result.tool_calls) {
      console.log('DEBUG: runLoop result:', JSON.stringify(result, null, 2));
    }

    expect(result.tool_calls).toBeDefined();
    expect(result.tool_calls?.[0].id).toBe('tc1');
  });

  it('should capture tool_calls when loop is paused', async () => {
    const mockTool = {
      name: 'pauseTool',
      execute: vi.fn().mockResolvedValue('TASK_PAUSED: wait'),
    };
    const executor = new AgentExecutor(mockProvider as any, [mockTool as any], 'test', 'Test');

    mockProvider.call.mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: 'pausing...',
      tool_calls: [
        { id: 'tc-pause', type: 'function', function: { name: 'pauseTool', arguments: '{}' } },
      ],
    });

    const result = await executor.runLoop([], {
      activeProfile: ReasoningProfile.STANDARD,
      maxIterations: 5,
      tracer: mockTracer as any,
      traceId: 't1',
      taskId: 't1',
      nodeId: 'n1',
      parentId: undefined,
      currentInitiator: 'superclaw',
      depth: 0,
      userId: 'u1',
      userText: 'test',
      mainConversationId: 'c1',
    });

    expect(result.paused).toBe(true);
    expect(result.tool_calls).toBeDefined();
    expect(result.tool_calls?.[0].id).toBe('tc-pause');
  });
});
