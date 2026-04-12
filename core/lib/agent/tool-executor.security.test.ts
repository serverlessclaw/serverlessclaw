import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutor, ToolExecutionContext } from './tool-executor';
import { ITool, ToolType, MessageRole } from '../types/index';
import { ClawTracer } from '../tracer';

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../registry', () => ({
  AgentRegistry: {
    recordToolUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockTracer = {
  addStep: vi.fn().mockResolvedValue(undefined),
} as unknown as ClawTracer;

vi.mock('../safety/safety-engine', () => {
  return {
    SafetyEngine: class {
      evaluateAction = vi.fn().mockResolvedValue({
        allowed: true,
        requiresApproval: false,
        reason: 'Authorized',
      });
    },
  };
});

describe('ToolExecutor Security', () => {
  const execContext: ToolExecutionContext = {
    traceId: 'trace-1',
    nodeId: 'node-1',
    agentId: 'test-agent',
    agentName: 'Test Agent',
    currentInitiator: 'user',
    depth: 0,
    userId: 'user-1',
    mainConversationId: 'conv-1',
    userText: 'hello',
  };

  const mockTools: ITool[] = [
    {
      name: 'any_tool',
      description: 'A tool that takes a path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          manuallyApproved: { type: 'boolean' },
        },
      },
      type: ToolType.FUNCTION,
      execute: vi.fn().mockResolvedValue('success'),
      connectionProfile: [],
      connector_id: '',
      requiresApproval: false,
      requiredPermissions: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks execution when a protected path is provided in arguments', async () => {
    const toolCalls = [
      {
        id: 'call-1',
        type: 'function' as const,
        function: {
          name: 'any_tool',
          arguments: JSON.stringify({ path: 'sst.config.ts' }),
        },
      },
    ];

    const messages: any[] = [];
    const attachments: any[] = [];

    const { SafetyEngine } = await import('../safety/safety-engine');
    const mockEvaluate = vi.mocked(new SafetyEngine().evaluateAction);
    mockEvaluate.mockResolvedValueOnce({
      allowed: false,
      requiresApproval: true,
      reason: 'PERMISSION_DENIED: protected path',
      appliedPolicy: 'protected_resource',
    });

    const result = await ToolExecutor.executeToolCalls(
      toolCalls,
      mockTools,
      messages,
      attachments,
      execContext,
      mockTracer
    );

    expect(result.toolCallCount).toBe(0);
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe(MessageRole.TOOL);
    expect(messages[0].content).toContain('PERMISSION_DENIED');
    expect(mockTools[0].execute).not.toHaveBeenCalled();
  });

  it('allows execution of protected path when manuallyApproved is true (AUTO mode)', async () => {
    const { EvolutionMode } = await import('../types/agent');
    const autoContext = {
      ...execContext,
      agentConfig: { evolutionMode: EvolutionMode.AUTO } as any,
    };

    const toolCalls = [
      {
        id: 'call-1',
        type: 'function' as const,
        function: {
          name: 'any_tool',
          arguments: JSON.stringify({ path: 'sst.config.ts', manuallyApproved: true }),
        },
      },
    ];

    const messages: any[] = [];
    const attachments: any[] = [];

    const result = await ToolExecutor.executeToolCalls(
      toolCalls,
      mockTools,
      messages,
      attachments,
      autoContext,
      mockTracer
    );

    expect(result.toolCallCount).toBe(1);
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('success');
    expect(mockTools[0].execute).toHaveBeenCalled();
  });

  it('allows execution for non-protected paths', async () => {
    const toolCalls = [
      {
        id: 'call-1',
        type: 'function' as const,
        function: {
          name: 'any_tool',
          arguments: JSON.stringify({ path: 'src/index.ts' }),
        },
      },
    ];

    const messages: any[] = [];
    const attachments: any[] = [];

    const result = await ToolExecutor.executeToolCalls(
      toolCalls,
      mockTools,
      messages,
      attachments,
      execContext,
      mockTracer
    );

    expect(result.toolCallCount).toBe(1);
    expect(mockTools[0].execute).toHaveBeenCalled();
  });
});
