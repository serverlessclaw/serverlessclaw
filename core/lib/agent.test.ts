import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from './agent';
import {
  IMemory,
  IProvider,
  MessageRole,
  TraceSource,
  Message,
  AttachmentType,
} from './types/index';
import { SYSTEM } from './constants';

// Create persistent mock functions
const mockGetTraceId = vi.fn();
const mockGetNodeId = vi.fn();
const mockGetParentId = vi.fn();
const mockStartTrace = vi.fn();
const mockAddStep = vi.fn();
const mockEndTrace = vi.fn();

// Mock ConfigManager
vi.mock('./registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn(),
    getTypedConfig: vi.fn(),
  },
}));

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
      getGlobalLessons: vi.fn().mockResolvedValue([]),
      addMessage: vi.fn().mockResolvedValue(undefined),
      updateDistilledMemory: vi.fn().mockResolvedValue(undefined),
      searchInsights: vi.fn().mockResolvedValue({ items: [] }),
      updateGapStatus: vi.fn().mockResolvedValue(undefined),
      getSummary: vi.fn().mockResolvedValue(null),
      updateSummary: vi.fn().mockResolvedValue(undefined),
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
        type: 'object' as const,
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
      model: SYSTEM.DEFAULT_MODEL,
      provider: SYSTEM.DEFAULT_PROVIDER,
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
        type: 'object' as const,
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
      model: SYSTEM.DEFAULT_MODEL,
      provider: SYSTEM.DEFAULT_PROVIDER,
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
      SYSTEM.DEFAULT_MODEL,
      SYSTEM.DEFAULT_PROVIDER,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );
  });

  it('should handle and persist attachments in process', async () => {
    const attachments = [{ type: AttachmentType.IMAGE, base64: 'data', name: 'test.png' }];

    mockProvider.call = vi
      .fn()
      .mockResolvedValue({ role: MessageRole.ASSISTANT, content: 'I see it' });

    const agent = new Agent(mockMemory, mockProvider, [], 'System', {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'System',
      model: SYSTEM.DEFAULT_MODEL,
      provider: SYSTEM.DEFAULT_PROVIDER,
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
      SYSTEM.DEFAULT_MODEL,
      SYSTEM.DEFAULT_PROVIDER,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );
  });

  describe('Dual-Mode Communication', () => {
    it('should use text mode by default when not specified', async () => {
      mockProvider.call = vi
        .fn()
        .mockResolvedValue({ role: MessageRole.ASSISTANT, content: 'Hello human' });

      const agent = new Agent(mockMemory, mockProvider, [], 'System prompt', {
        id: 'test-agent',
        name: 'Test Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        defaultCommunicationMode: 'text',
        model: SYSTEM.DEFAULT_MODEL,
        provider: SYSTEM.DEFAULT_PROVIDER,
      });

      await agent.process('user-1', 'hi', { source: TraceSource.TELEGRAM });

      expect(mockProvider.call).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        expect.anything(),
        SYSTEM.DEFAULT_MODEL,
        SYSTEM.DEFAULT_PROVIDER,
        undefined, // No responseFormat in text mode
        undefined,
        undefined,
        undefined,
        undefined
      );
    });

    it('should inject structured output when communicationMode is json', async () => {
      const jsonOutput = JSON.stringify({
        status: 'SUCCESS',
        message: 'Task completed successfully',
      });
      mockProvider.call = vi
        .fn()
        .mockResolvedValue({ role: MessageRole.ASSISTANT, content: jsonOutput });

      // Mock capabilities to support structured output
      mockProvider.getCapabilities = vi.fn().mockResolvedValue({
        supportedReasoningProfiles: ['standard'],
        supportsStructuredOutput: true,
      });

      const agent = new Agent(mockMemory, mockProvider, [], 'System prompt', {
        id: 'test-agent',
        name: 'Test Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        defaultCommunicationMode: 'json',
        model: SYSTEM.DEFAULT_MODEL,
        provider: SYSTEM.DEFAULT_PROVIDER,
      });

      await agent.process('user-1', 'do math', { source: TraceSource.SYSTEM });

      // Verify schema was injected (it should be DEFAULT_SIGNAL_SCHEMA)
      expect(mockProvider.call).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Array),
        expect.anything(),
        SYSTEM.DEFAULT_MODEL,
        SYSTEM.DEFAULT_PROVIDER,
        expect.objectContaining({
          type: 'json_schema',
          json_schema: expect.objectContaining({ name: 'agent_signal' }),
        }),
        undefined,
        undefined,
        undefined,
        undefined
      );

      // Verify intelligent extraction of the "message" field for the chat history
      expect(mockMemory.addMessage).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ content: 'Task completed successfully' })
      );
    });

    it('should extract "plan" field from structured output when applicable', async () => {
      const jsonOutput = JSON.stringify({
        status: 'SUCCESS',
        plan: 'New strategy designed.',
      });
      mockProvider.call = vi
        .fn()
        .mockResolvedValue({ role: MessageRole.ASSISTANT, content: jsonOutput });

      mockProvider.getCapabilities = vi.fn().mockResolvedValue({
        supportedReasoningProfiles: ['standard'],
        supportsStructuredOutput: true,
      });

      const agent = new Agent(mockMemory, mockProvider, [], 'System prompt', {
        id: 'test-agent',
        name: 'Test Agent',
        enabled: true,
        systemPrompt: 'System prompt',
        defaultCommunicationMode: 'json',
        model: SYSTEM.DEFAULT_MODEL,
        provider: SYSTEM.DEFAULT_PROVIDER,
      });

      await agent.process('user-1', 'plan', { source: TraceSource.SYSTEM });

      expect(mockMemory.addMessage).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ content: 'New strategy designed.' })
      );
    });
  });
});
