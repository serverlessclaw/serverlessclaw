import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from './agent';
import { IMemory, IProvider, MessageRole, TraceSource, Message } from './types/index';

// Create persistent mock functions
const mockGetTraceId = vi.fn();
const mockGetNodeId = vi.fn();
const mockGetParentId = vi.fn();
const mockStartTrace = vi.fn();
const mockAddStep = vi.fn();
const mockEndTrace = vi.fn();

// Mock Tracer as a class that uses these functions
vi.mock('./tracer', () => {
  return {
    ClawTracer: class {
      constructor(
        public userId: string,
        public source: TraceSource | string,
        public traceId: string,
        public nodeId: string,
        public parentId: string
      ) {}
      getTraceId = mockGetTraceId;
      getNodeId = mockGetNodeId;
      getParentId = mockGetParentId;
      startTrace = mockStartTrace;
      addStep = mockAddStep;
      endTrace = mockEndTrace;
    },
  };
});

describe('Agent Trace Propagation', () => {
  let mockMemory: IMemory;
  let mockProvider: IProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      getHistory: vi.fn().mockResolvedValue([]),
      getDistilledMemory: vi.fn().mockResolvedValue(''),
      getLessons: vi.fn().mockResolvedValue([]),
      addMessage: vi.fn().mockResolvedValue(undefined),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
      searchInsights: vi.fn().mockResolvedValue([]),
      updateGapStatus: vi.fn().mockResolvedValue(undefined),
    } as unknown as IMemory;

    mockProvider = {
      call: vi.fn().mockResolvedValue({ role: MessageRole.ASSISTANT, content: 'Hello' }),
      getCapabilities: vi
        .fn()
        .mockResolvedValue({ supportedReasoningProfiles: ['standard', 'fast'] }),
    } as unknown as IProvider;

    // Default mock behaviors
    mockGetTraceId.mockReturnValue('mock-trace-id');
    mockGetNodeId.mockReturnValue('root');
    mockGetParentId.mockReturnValue(undefined);
    mockStartTrace.mockResolvedValue('mock-trace-id');
    mockAddStep.mockResolvedValue(undefined);
    mockEndTrace.mockResolvedValue(undefined);
  });

  it('should propagate trace context to tool arguments', async () => {
    const mockTool = {
      name: 'testTool',
      description: 'Test Tool',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: vi.fn().mockResolvedValue('Tool result'),
    };

    mockProvider.call = vi
      .fn()
      .mockResolvedValueOnce({
        role: MessageRole.ASSISTANT,
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'testTool', arguments: '{}' },
          },
        ],
      })
      .mockResolvedValueOnce({ role: MessageRole.ASSISTANT, content: 'Final response' });

    // Set specific IDs for this test
    mockGetTraceId.mockReturnValue('trace-123');
    mockGetNodeId.mockReturnValue('node-456');
    mockGetParentId.mockReturnValue('parent-789');

    const agent = new Agent(mockMemory, mockProvider, [mockTool], 'System prompt', {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'System prompt',
    });

    await agent.process('user-1', 'Hello', {
      traceId: 'trace-123',
      nodeId: 'node-456',
      parentId: 'parent-789',
    });

    expect(mockTool.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-123',
        nodeId: 'node-456',
        parentId: 'parent-789',
      })
    );
  });

  it('should handle ToolResult objects returned from tools', async () => {
    const mockTool = {
      name: 'multiModalTool',
      description: 'Test Tool',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: vi.fn().mockResolvedValue({
        text: 'Result text',
        images: ['base64-image-data'],
        metadata: { foo: 'bar' },
      }),
    };

    mockProvider.call = vi
      .fn()
      .mockResolvedValueOnce({
        role: MessageRole.ASSISTANT,
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'multiModalTool', arguments: '{}' },
          },
        ],
      })
      .mockResolvedValueOnce({ role: MessageRole.ASSISTANT, content: 'Done' });

    const agent = new Agent(mockMemory, mockProvider, [mockTool], 'System', {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'System',
    });

    await agent.process('user-1', 'Hello', {});

    // Check that the text part was sent back to the LLM
    expect(mockProvider.call).toHaveBeenCalled();
    const lastCallHistory = vi.mocked(mockProvider.call).mock.calls.slice(-1)[0][0];
    expect(lastCallHistory).toSatisfy((history: Message[]) =>
      history.some((m) => m.role === MessageRole.TOOL && m.content === 'Result text')
    );
  });

  it('should skip local execution for built-in tools', async () => {
    mockProvider.call = vi
      .fn()
      .mockResolvedValueOnce({
        role: MessageRole.ASSISTANT,
        content: '',
        tool_calls: [
          {
            id: 'call-built-in',
            type: 'function',
            function: { name: 'code_interpreter', arguments: '{"code": "print(1)"}' },
          },
        ],
      })
      .mockResolvedValueOnce({ role: MessageRole.ASSISTANT, content: 'Calculated' });

    // No tools provided to agent, but provider requests code_interpreter
    const agent = new Agent(mockMemory, mockProvider, [], 'System', {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'System',
    });

    await agent.process('user-1', 'Run code', {});

    // Should NOT throw error, and should send a dummy result to LLM to keep loop happy
    expect(mockProvider.call).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: MessageRole.TOOL,
          content: 'EXECUTED_BY_PROVIDER',
        }),
      ]),
      expect.anything(),
      expect.anything(),
      undefined,
      undefined
    );
  });

  it('should handle and persist attachments in process', async () => {
    const attachments = [{ type: 'image' as const, base64: 'data', name: 'test.png' }];

    mockProvider.call = vi
      .fn()
      .mockResolvedValue({ role: MessageRole.ASSISTANT, content: 'I see it' });

    const agent = new Agent(mockMemory, mockProvider, [], 'System', {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'System',
    });

    await agent.process('user-1', 'What is this?', { attachments });

    // Check memory persistence
    expect(mockMemory.addMessage).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        role: MessageRole.USER,
        attachments,
      })
    );

    // Check provider call
    expect(mockProvider.call).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: MessageRole.USER,
          attachments,
        }),
      ]),
      expect.anything(),
      expect.anything(),
      undefined,
      undefined
    );
  });
});
