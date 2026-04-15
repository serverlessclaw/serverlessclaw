import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentExecutor } from './executor';
import { Message, MessageRole, ReasoningProfile } from '../types/index';

vi.mock('../../handlers/events/cancellation-handler', () => ({
  isTaskCancelled: vi.fn().mockResolvedValue(false),
  handleTaskCancellation: vi.fn(),
}));

vi.mock('../safety/safety-engine', () => {
  return {
    SafetyEngine: class {
      evaluateAction = vi.fn().mockImplementation(async (config, action) => {
        if (action === 'deleteDatabase') {
          return {
            allowed: true,
            requiresApproval: true,
            reason: 'APPROVAL_REQUIRED:call-high-risk',
          };
        }
        return {
          allowed: true,
          requiresApproval: false,
          reason: 'Authorized',
        };
      });
      getClassCBlastRadius = vi.fn().mockReturnValue({});
    },
  };
});

vi.mock('../constants', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    TRACE_TYPES: { TOOL_CALL: 'tool_call', TOOL_RESULT: 'tool_result' },
    TIME: { MS_PER_MINUTE: 60000, MS_PER_HOUR: 3600000 },
    LIMITS: { MAX_ITERATIONS: 10, MAX_CONTEXT_TOKENS: 4000 },
  };
});

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

    const result = await executorWithTool.runLoop(
      [],
      getDefaultOptions({
        traceId: 'trace-123',
        taskId: 'trace-123',
        userText: 'pause me',
      })
    );

    expect(result.paused).toBe(true);
    expect(result.responseText).toBe('I am pausing now');
    expect(result.pauseMessage).toBe('TASK_PAUSED: I am pausing now (Trace: trace-123).');
  });

  it('should handle responses with only TASK_PAUSED prefix', async () => {
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

    const result = await executorWithTool.runLoop(
      [],
      getDefaultOptions({
        traceId: 't1',
        taskId: 't1',
        userText: 'wait',
        mainConversationId: 'c1',
      })
    );

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

    await executorWithTool.runLoop(
      [],
      getDefaultOptions({
        traceId: 't-123',
        taskId: 't-123',
        userText: 'original user query',
      })
    );

    expect(mockTool.execute).toHaveBeenCalled();
    const callArgs = (mockTool.execute as any).mock.calls[0][0];
    expect(callArgs.agentId).toBe('special-agent');
    expect(callArgs.task).toBe('sub-task content');
    expect(callArgs.executorAgentId).toBe('main-agent');
    expect(callArgs.originalUserTask).toBe('original user query');
  });

  it('should allow SuperClaw (superclaw) to dispatch to strategic-planner without collision', async () => {
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

    await executor.runLoop(
      [],
      getDefaultOptions({
        traceId: 'trace-abc',
        taskId: 'trace-abc',
        userText: 'How many agents do we have?',
        mainConversationId: 'session-123',
      })
    );

    expect(mockDispatchTask.execute).toHaveBeenCalled();
    const resultText = (mockDispatchTask.execute as any).mock.results[0].value;
    expect(await resultText).toBe('SUCCESS: dispatched to strategic-planner');

    const finalArgs = (mockDispatchTask.execute as any).mock.calls[0][0];
    expect(finalArgs.executorAgentId).toBe('superclaw');
    expect(finalArgs.initiatorId).toBe('superclaw');
    expect(finalArgs.originalUserTask).toBe('How many agents do we have?');
  });

  it('should abort and return TASK_CANCELLED if task is marked as cancelled', async () => {
    const { isTaskCancelled } = await import('../../handlers/events/cancellation-handler');
    vi.mocked(isTaskCancelled).mockImplementation(async (taskId) => taskId === 'task-to-cancel');

    const executor = new AgentExecutor(mockProvider as any, [], 'agent-1', 'Agent 1');

    const result = await executor.runLoop(
      [],
      getDefaultOptions({
        traceId: 'trace-cancel',
        taskId: 'task-to-cancel',
        userText: 'work',
      })
    );

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

    const result = await executor.runLoop(
      [],
      getDefaultOptions({
        traceId: 't1',
        taskId: 't1',
        userText: 'test',
      })
    );

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

    const result = await executor.runLoop(
      [],
      getDefaultOptions({
        traceId: 't1',
        taskId: 't1',
        userText: 'test',
      })
    );

    expect(result.paused).toBe(true);
    expect(result.tool_calls).toBeDefined();
    expect(result.tool_calls?.[0].id).toBe('tc-pause');
  });

  it('should pause and request approval for high-risk tools', async () => {
    const mockHighRiskTool = {
      name: 'deleteDatabase',
      description: 'Deletes a database',
      parameters: { type: 'object', properties: {} },
      requiresApproval: true,
      requiredPermissions: [],
      execute: vi.fn().mockResolvedValue('SUCCESS: deleted'),
    };

    const executor = new AgentExecutor(
      mockProvider as any,
      [mockHighRiskTool as any],
      'test-agent',
      'Test Agent'
    );

    mockProvider.call.mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: 'I will delete the database.',
      tool_calls: [
        {
          id: 'call-high-risk',
          type: 'function',
          function: { name: 'deleteDatabase', arguments: '{}' },
        },
      ],
    });

    const result = await executor.runLoop(
      [],
      getDefaultOptions({
        traceId: 't1',
        taskId: 't1',
        userId: 'SYSTEM',
        userText: 'delete db',
      })
    );

    expect(result.paused).toBe(true);
    expect(result.pauseMessage).toBe('APPROVAL_REQUIRED:call-high-risk');
    expect(result.options).toEqual([
      { label: 'Approve Tool', value: 'APPROVE_TOOL_CALL:call-high-risk', type: 'primary' },
      { label: 'Reject Tool', value: 'REJECT_TOOL_CALL:call-high-risk', type: 'danger' },
      { label: 'Clarify', value: 'CLARIFY_TOOL_CALL:call-high-risk', type: 'secondary' },
    ]);
    expect(mockHighRiskTool.execute).not.toHaveBeenCalled();
  });

  describe('Signal Handling', () => {
    it('should handle TOOL_REJECTION signal', async () => {
      const executor = new AgentExecutor(mockProvider as any, [], 'test-agent', 'Test Agent');

      const messages: Message[] = [];
      const options = getDefaultOptions({
        userText: 'TOOL_REJECTION:call-123 User changed their mind',
      });

      // Mock callLLM to just return a simple response
      vi.spyOn((executor as any).core.standardExecutor, 'callLLM').mockResolvedValue({
        role: MessageRole.ASSISTANT,
        content: 'I understand you rejected the tool.',
      });

      await executor.runLoop(messages, options);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(
        expect.objectContaining({
          role: MessageRole.TOOL,
          tool_call_id: 'call-123',
          content: 'USER_REJECTED_EXECUTION: User changed their mind',
          traceId: 'trace-123',
          messageId: expect.any(String),
        })
      );
    });

    it('should handle TOOL_CLARIFICATION signal', async () => {
      const executor = new AgentExecutor(mockProvider as any, [], 'test-agent', 'Test Agent');

      const messages: Message[] = [];
      const options = getDefaultOptions({
        userText: 'TOOL_CLARIFICATION:call-456 Please use the staging environment',
      });

      vi.spyOn((executor as any).core.standardExecutor, 'callLLM').mockResolvedValue({
        role: MessageRole.ASSISTANT,
        content: 'I will use staging.',
      });

      await executor.runLoop(messages, options);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(
        expect.objectContaining({
          role: MessageRole.TOOL,
          tool_call_id: 'call-456',
          content: 'USER_CLARIFICATION: Please use the staging environment',
          traceId: 'trace-123',
          messageId: expect.any(String),
        })
      );
    });

    it('should handle signals without extra text', async () => {
      const executor = new AgentExecutor(mockProvider as any, [], 'test-agent', 'Test Agent');

      const messages: Message[] = [];
      const options = getDefaultOptions({
        userText: 'TOOL_REJECTION:call-789',
      });

      vi.spyOn((executor as any).core.standardExecutor, 'callLLM').mockResolvedValue({
        role: MessageRole.ASSISTANT,
        content: 'Rejected.',
      });

      await executor.runLoop(messages, options);

      expect(messages[0].content).toBe(
        'USER_REJECTED_EXECUTION: User rejected this tool execution.'
      );
    });
  });

  it('should execute high-risk tool if call ID is in approvedToolCalls', async () => {
    const mockHighRiskTool = {
      name: 'deleteDatabase',
      description: 'Deletes a database',
      parameters: { type: 'object', properties: {} },
      requiresApproval: true,
      requiredPermissions: [],
      execute: vi.fn().mockResolvedValue('SUCCESS: deleted'),
    };

    const executor = new AgentExecutor(
      mockProvider as any,
      [mockHighRiskTool as any],
      'test-agent',
      'Test Agent'
    );

    mockProvider.call
      .mockResolvedValueOnce({
        role: MessageRole.ASSISTANT,
        content: 'I will delete the database.',
        tool_calls: [
          {
            id: 'call-approved',
            type: 'function',
            function: { name: 'deleteDatabase', arguments: '{}' },
          },
        ],
      })
      .mockResolvedValueOnce({
        role: MessageRole.ASSISTANT,
        content: 'SUCCESS: deleted',
      });

    const result = await executor.runLoop(
      [],
      getDefaultOptions({
        traceId: 't1',
        taskId: 't1',
        userId: 'SYSTEM',
        userText: 'delete db',
        maxIterations: 2,
        approvedToolCalls: ['call-approved'],
      })
    );

    expect(mockHighRiskTool.execute).toHaveBeenCalled();
    expect(result.responseText).toBe('SUCCESS: deleted');
  });

  it('should trigger context truncation when messages exceed 90% of limit', async () => {
    const longContent = 'x'.repeat(3000);
    const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? MessageRole.USER : MessageRole.ASSISTANT,
      content: longContent,
      traceId: 't1',
      messageId: `m${i}`,
    }));

    const executor = new AgentExecutor(
      mockProvider as any,
      [],
      'test-agent',
      'Test Agent',
      'System prompt for context management testing',
      null,
      5000
    );

    mockProvider.call.mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: 'done after truncation',
    });

    const result = await executor.runLoop(
      messages,
      getDefaultOptions({
        traceId: 't1',
        taskId: 't1',
        userText: 'test',
        maxIterations: 1,
      })
    );

    expect(result.responseText).toBe('done after truncation');
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].role).toBe(MessageRole.SYSTEM);
  });

  it('should handle TOOL_REJECTION with no reason text', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'test-agent', 'Test Agent');

    const messages: Message[] = [];
    const options = getDefaultOptions({
      userText: 'TOOL_REJECTION:call-999',
    });

    vi.spyOn((executor as any).core.standardExecutor, 'callLLM').mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: 'Rejected.',
    });

    await executor.runLoop(messages, options);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('USER_REJECTED_EXECUTION: User rejected this tool execution.');
  });

  it('should handle TOOL_CLARIFICATION with no comment text', async () => {
    const executor = new AgentExecutor(mockProvider as any, [], 'test-agent', 'Test Agent');

    const messages: Message[] = [];
    const options = getDefaultOptions({
      userText: 'TOOL_CLARIFICATION:call-888',
    });

    vi.spyOn((executor as any).core.standardExecutor, 'callLLM').mockResolvedValue({
      role: MessageRole.ASSISTANT,
      content: 'Clarified.',
    });

    await executor.runLoop(messages, options);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('USER_CLARIFICATION: ');
  });
});
