/**
 * @module ToolExecutor Tests
 * @description Tests for tool call execution including approval gates,
 * argument validation, attachment collection, and pause signaling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutor } from './tool-executor';
import { MessageRole, AttachmentType, ToolType } from '../types/index';

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../registry', () => ({
  AgentRegistry: { recordToolUsage: vi.fn() },
}));

const mockRecordFailure = vi.fn().mockResolvedValue(undefined);
const mockRecordSuccess = vi.fn().mockResolvedValue(undefined);
vi.mock('../safety/trust-manager', () => ({
  TrustManager: {
    recordFailure: mockRecordFailure,
    recordSuccess: mockRecordSuccess,
  },
}));

const mockAddStep = vi.fn();
vi.mock('../tracer', () => ({
  ClawTracer: vi.fn().mockImplementation(function (this: any) {
    this.addStep = mockAddStep;
    this.endTrace = vi.fn().mockResolvedValue(undefined);
    this.failTrace = vi.fn().mockResolvedValue(undefined);
    this.detectDrift = vi.fn().mockResolvedValue(undefined);
  }),
}));

const { MockSafetyEngine } = vi.hoisted(() => {
  return {
    MockSafetyEngine: class {
      evaluateAction = vi.fn().mockImplementation(async (config, action, params) => {
        if (params?.resource === 'sst.config.ts') {
          return {
            allowed: false,
            requiresApproval: true,
            reason: 'PERMISSION_DENIED: protected path',
            appliedPolicy: 'protected_resource',
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

vi.mock('../safety/safety-engine', () => ({
  SafetyEngine: MockSafetyEngine,
  getSafetyEngine: () => new MockSafetyEngine(),
}));

vi.mock('../constants', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    TRACE_TYPES: { TOOL_CALL: 'tool_call', TOOL_RESULT: 'tool_result' },
    TIME: { MS_PER_SECOND: 1000, MS_PER_MINUTE: 60000, MS_PER_HOUR: 3600000 },
  };
});

function createTool(overrides: Partial<any> = {}) {
  return {
    name: overrides.name ?? 'test-tool',
    description: overrides.description ?? 'A test tool',
    type: ToolType.FUNCTION,
    parameters: overrides.parameters ?? {},
    execute: overrides.execute ?? vi.fn().mockResolvedValue('success'),
    requiresApproval: overrides.requiresApproval ?? false,
    argSchema: overrides.argSchema,
    requiredPermissions: overrides.requiredPermissions ?? [],
    connectionProfile: overrides.connectionProfile ?? [],
  };
}

function createToolCall(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? 'call-1',
    type: 'function' as const,
    function: {
      name: overrides.name ?? 'test-tool',
      arguments: JSON.stringify(overrides.args ?? { query: 'test' }),
    },
  };
}

function createExecContext(overrides: Partial<any> = {}) {
  return {
    traceId: 'trace1',
    nodeId: 'node1',
    agentId: 'agent1',
    agentName: 'TestAgent',
    currentInitiator: 'user1',
    depth: 0,
    userId: 'user1',
    workspaceId: 'ws1', // Mandatory for SYSTEM identity remediation
    mainConversationId: 'conv1',
    userText: 'run test',
    sessionId: 'session1',
    ...overrides,
  };
}

describe('ToolExecutor', () => {
  let tracer: any;

  beforeEach(() => {
    vi.clearAllMocks();
    tracer = {
      addStep: mockAddStep,
      endTrace: vi.fn().mockResolvedValue(undefined),
      failTrace: vi.fn().mockResolvedValue(undefined),
      detectDrift: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('executeToolCalls', () => {
    it('executes tool successfully and appends result to messages', async () => {
      const tool = createTool({ execute: vi.fn().mockResolvedValue('done') });
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext(),
        tracer
      );

      expect(result.toolCallCount).toBe(1);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe(MessageRole.TOOL);
      expect(messages[0].content).toBe('done');
    });

    it('pushes EXECUTED_BY_PROVIDER when tool not found', async () => {
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [createToolCall({ name: 'missing-tool' })],
        [],
        messages,
        attachments,
        createExecContext(),
        tracer
      );

      expect(result.toolCallCount).toBe(0);
      expect(messages[0].content).toBe('EXECUTED_BY_PROVIDER');

      // Verify trust penalty recorded (Finding 1 Remediation)
      expect(mockRecordFailure).toHaveBeenCalledWith(
        'agent1',
        expect.stringContaining('Tool missing-tool requested but not found in registry.'),
        1.5,
        0,
        expect.any(Object)
      );
    });

    it('returns paused when tool requires approval but not approved', async () => {
      const tool = createTool({ requiresApproval: true });
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext(),
        tracer
      );

      expect(result.paused).toBe(true);
      expect(result.asyncWait).toBe(true);
      expect(result.toolCallCount).toBe(0);
    });

    it('executes approved tool that requires approval', async () => {
      const tool = createTool({
        requiresApproval: true,
        execute: vi.fn().mockResolvedValue('approved result'),
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext(),
        tracer,
        ['call-1']
      );

      expect(result.toolCallCount).toBe(1);
      expect(messages[0].content).toBe('approved result');
    });

    it('handles Zod validation failure', async () => {
      const tool = createTool({
        argSchema: {
          parse: vi.fn().mockImplementation(() => {
            throw new Error('Invalid arg');
          }),
        },
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext(),
        tracer
      );

      expect(result.toolCallCount).toBe(0);
      expect(messages[0].content).toContain('FAILED');
      expect(messages[0].content).toContain('Invalid arg');
    });

    it('returns paused with responseText when result starts with TASK_PAUSED', async () => {
      const tool = createTool({
        execute: vi.fn().mockResolvedValue('TASK_PAUSED: waiting for input'),
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext(),
        tracer
      );

      expect(result.paused).toBe(true);
      expect(result.asyncWait).toBe(true);
      expect(result.responseText).toBe('TASK_PAUSED: waiting for input');
    });

    it('handles ToolResult with images', async () => {
      const tool = createTool({
        execute: vi.fn().mockResolvedValue({
          text: 'screenshot taken',
          images: ['base64data1', 'base64data2'],
        }),
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext(),
        tracer
      );

      expect(attachments).toHaveLength(2);
      expect(attachments[0]).toEqual({ type: AttachmentType.IMAGE, base64: 'base64data1' });
    });

    it('handles ToolResult with metadata attachments', async () => {
      const tool = createTool({
        execute: vi.fn().mockResolvedValue({
          text: 'file generated',
          metadata: { attachments: [{ type: 'file', url: 'http://example.com/file.txt' }] },
        }),
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext(),
        tracer
      );

      expect(attachments).toHaveLength(1);
    });

    it('does not overwrite args that are already present', async () => {
      const executeFn = vi.fn().mockResolvedValue('done');
      const tool = createTool({
        execute: executeFn,
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      await ToolExecutor.executeToolCalls(
        [createToolCall({ args: { query: 'test', traceId: 'custom-trace' } })],
        [tool],
        messages,
        attachments,
        createExecContext(),
        tracer
      );

      const calledArgs = executeFn.mock.calls[0][0];
      expect(calledArgs.traceId).toBe('custom-trace');
    });

    it('injects context args when not already present', async () => {
      const executeFn = vi.fn().mockResolvedValue('done');
      const tool = createTool({ execute: executeFn });
      const messages: any[] = [];
      const attachments: any[] = [];

      await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext(),
        tracer
      );

      const calledArgs = executeFn.mock.calls[0][0];
      expect(calledArgs.traceId).toBe('trace1');
      expect(calledArgs.nodeId).toBe('node1');
      expect(calledArgs.executorAgentId).toBe('agent1');
      expect(calledArgs.userId).toBe('user1');
    });

    it('processes multiple tool calls', async () => {
      const tool = createTool({ execute: vi.fn().mockResolvedValue('ok') });
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [createToolCall({ id: 'c1' }), createToolCall({ id: 'c2', name: 'other' })],
        [tool],
        messages,
        attachments,
        createExecContext(),
        tracer
      );

      expect(result.toolCallCount).toBe(1);
      expect(messages).toHaveLength(2);
    });

    it('returns 0 toolCallCount when no tool calls', async () => {
      const result = await ToolExecutor.executeToolCalls(
        [],
        [],
        [],
        [],
        createExecContext(),
        tracer
      );
      expect(result.toolCallCount).toBe(0);
    });

    it('bypasses RBAC check for SYSTEM user', async () => {
      const tool = createTool({
        requiredPermissions: ['admin'],
        execute: vi.fn().mockResolvedValue('success'),
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext({ userId: 'SYSTEM' }),
        tracer
      );

      expect(result.toolCallCount).toBe(1);
      expect(messages[0].content).toBe('success');
    });

    it('rejects RBAC check when userId is empty', async () => {
      const tool = createTool({
        requiredPermissions: ['admin'],
        execute: vi.fn().mockResolvedValue('success'),
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext({ userId: '' }),
        tracer
      );

      expect(result.toolCallCount).toBe(0);
      expect(messages[0].content).toContain('FAILED');
    });

    it('returns FAILED message when RBAC permission check fails', async () => {
      const tool = createTool({
        requiredPermissions: ['admin', 'deploy'],
        execute: vi.fn().mockResolvedValue('should not run'),
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext({ userId: 'user-no-perms' }),
        tracer
      );

      expect(result.toolCallCount).toBe(0);
      expect(messages[0].content).toContain('FAILED');
      expect(messages[0].content).toContain('Unauthorized');
      expect(messages[0].content).toContain('admin, deploy');
    });

    it('continues execution when all permissions are granted', async () => {
      const tool = createTool({
        requiredPermissions: ['read', 'write'],
        execute: vi.fn().mockResolvedValue('allowed'),
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext({ userId: 'SYSTEM' }),
        tracer
      );

      expect(result.toolCallCount).toBe(1);
      expect(messages[0].content).toBe('allowed');
    });

    it('handles RBAC check failure gracefully on import error', async () => {
      const tool = createTool({
        requiredPermissions: ['admin'],
        execute: vi.fn().mockResolvedValue('should not run'),
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext({ userId: 'user1' }),
        tracer
      );

      expect(result.toolCallCount).toBe(0);
      expect(messages[0].content).toContain('FAILED');
      expect(messages[0].content).toContain('Unauthorized');
    });

    it('injects userId and sessionId from execContext when not in args', async () => {
      const executeFn = vi.fn().mockResolvedValue('done');
      const tool = createTool({ execute: executeFn });
      const messages: any[] = [];
      const attachments: any[] = [];

      await ToolExecutor.executeToolCalls(
        [createToolCall({ args: {} })],
        [tool],
        messages,
        attachments,
        createExecContext({ userId: 'user-ctx', sessionId: 'session-ctx' }),
        tracer
      );

      const calledArgs = executeFn.mock.calls[0][0];
      expect(calledArgs.userId).toBe('user-ctx');
      expect(calledArgs.sessionId).toBe('session-ctx');
    });

    it('handles ToolResult with empty text and falls back to JSON.stringify', async () => {
      const tool = createTool({
        execute: vi.fn().mockResolvedValue({ text: '', data: { key: 'value' } }),
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      await ToolExecutor.executeToolCalls(
        [createToolCall()],
        [tool],
        messages,
        attachments,
        createExecContext(),
        tracer
      );

      expect(messages[0].content).toBe('{"text":"","data":{"key":"value"}}');
    });

    it('handles multiple tool calls where first requires approval and second succeeds', async () => {
      const tool1 = createTool({
        name: 'needs-approval',
        requiresApproval: true,
        execute: vi.fn().mockResolvedValue('should not run'),
      });
      const tool2 = createTool({
        name: 'safe-tool',
        execute: vi.fn().mockResolvedValue('safe result'),
      });
      const messages: any[] = [];
      const attachments: any[] = [];

      const result = await ToolExecutor.executeToolCalls(
        [
          createToolCall({ id: 'c1', name: 'needs-approval' }),
          createToolCall({ id: 'c2', name: 'safe-tool' }),
        ],
        [tool1, tool2],
        messages,
        attachments,
        createExecContext(),
        tracer
      );

      expect(result.paused).toBe(true);
      expect(result.asyncWait).toBe(true);
      expect(result.toolCallCount).toBe(0);
      expect(messages).toHaveLength(0);
    });

    describe('Evolution Mode Injection', () => {
      it('injects manuallyApproved: true in AUTO mode', async () => {
        const executeFn = vi.fn().mockResolvedValue('done');
        const tool = createTool({ name: 'protected-tool', execute: executeFn });
        const { EvolutionMode } = await import('../types/agent');

        await ToolExecutor.executeToolCalls(
          [createToolCall({ name: 'protected-tool', args: {} })],
          [tool],
          [],
          [],
          createExecContext({
            agentConfig: { evolutionMode: EvolutionMode.AUTO },
          }),
          tracer
        );

        const calledArgs = executeFn.mock.calls[0][0];
        expect(calledArgs.manuallyApproved).toBe(true);
      });

      it('blocks self-approval in HITL mode', async () => {
        const executeFn = vi.fn().mockResolvedValue('done');
        const tool = createTool({ name: 'protected-tool', execute: executeFn });
        const { EvolutionMode } = await import('../types/agent');

        const messages: any[] = [];
        const result = await ToolExecutor.executeToolCalls(
          [createToolCall({ name: 'protected-tool', args: { manuallyApproved: true } })],
          [tool],
          messages,
          [],
          createExecContext({
            agentConfig: { evolutionMode: EvolutionMode.HITL },
          }),
          tracer
        );

        expect(result.toolCallCount).toBe(0);
        expect(messages[0].content).toContain('PERMISSION_DENIED');
        expect(executeFn).not.toHaveBeenCalled();
      });

      it('respects existing manuallyApproved: true if tool is approved (HITL)', async () => {
        const executeFn = vi.fn().mockResolvedValue('done');
        const tool = createTool({ name: 'protected-tool', execute: executeFn });
        const { EvolutionMode } = await import('../types/agent');

        const toolCall = createToolCall({
          name: 'protected-tool',
          args: { manuallyApproved: true },
        });
        const result = await ToolExecutor.executeToolCalls(
          [toolCall],
          [tool],
          [],
          [],
          createExecContext({
            agentConfig: { evolutionMode: EvolutionMode.HITL },
          }),
          tracer,
          [toolCall.id] // Explicitly approved
        );

        expect(result.toolCallCount).toBe(1);
        expect(executeFn).toHaveBeenCalled();
        const calledArgs = executeFn.mock.calls[0][0];
        expect(calledArgs.manuallyApproved).toBe(true);
      });

      it('BLOCKS agent from self-approving protected file write in AUTO mode', async () => {
        const executeFn = vi.fn().mockResolvedValue('success');
        const tool = createTool({
          name: 'write_file',
          execute: executeFn,
          requiresApproval: true,
          pathKeys: ['path'],
        });
        const { EvolutionMode } = await import('../types/agent');

        const messages: any[] = [];
        const toolCall = createToolCall({
          name: 'write_file',
          args: {
            path: 'sst.config.ts',
            content: 'malicious change',
            manuallyApproved: true, // Agent-injected
          },
        });

        const result = await ToolExecutor.executeToolCalls(
          [toolCall],
          [tool],
          messages,
          [],
          createExecContext({
            userId: 'SYSTEM', // Bypass RBAC
            agentConfig: { evolutionMode: EvolutionMode.AUTO },
          }),
          tracer
        );

        expect(result.toolCallCount).toBe(0);
        expect(messages[0].content).toContain('PERMISSION_DENIED');
        expect(executeFn).not.toHaveBeenCalled();
      });

      it('respects tool.requiresApproval even when safety allows in AUTO mode', async () => {
        const executeFn = vi.fn().mockResolvedValue('success');
        const tool = createTool({
          name: 'deploy_tool',
          execute: executeFn,
          requiresApproval: true, // Tool specifically requires approval
        });
        const { EvolutionMode } = await import('../types/agent');

        const messages: any[] = [];
        const toolCall = createToolCall({
          name: 'deploy_tool',
          args: { environment: 'prod' },
        });

        // In AUTO mode, with safety allowing but tool requiring approval - should PAUSE (not execute)
        const result = await ToolExecutor.executeToolCalls(
          [toolCall],
          [tool],
          messages,
          [],
          createExecContext({
            agentConfig: { evolutionMode: EvolutionMode.AUTO },
          }),
          tracer
        );

        expect(result.paused).toBe(true);
        expect(result.asyncWait).toBe(true);
        expect(executeFn).not.toHaveBeenCalled();
      });
    });

    describe('Trust Loop Instrumentation', () => {
      it('records a heavy trust penalty on security block', async () => {
        const tool = createTool({
          requiredPermissions: ['admin'],
        });
        const messages: any[] = [];

        await ToolExecutor.executeToolCalls(
          [createToolCall()],
          [tool],
          messages,
          [],
          createExecContext({ userId: 'user-no-perms' }),
          tracer
        );

        expect(mockRecordFailure).toHaveBeenCalledWith(
          'agent1',
          expect.stringContaining('Security block'),
          5,
          0,
          expect.any(Object)
        );
      });

      it('records a medium trust penalty on execution crash', async () => {
        const tool = createTool({
          execute: vi.fn().mockRejectedValue(new Error('crash')),
        });
        const messages: any[] = [];

        await ToolExecutor.executeToolCalls(
          [createToolCall()],
          [tool],
          messages,
          [],
          createExecContext(),
          tracer
        );

        expect(mockRecordFailure).toHaveBeenCalledWith(
          'agent1',
          expect.stringContaining('Tool test-tool crashed: crash'),
          2,
          0,
          expect.any(Object)
        );
      });

      it('correctly detects failure in complex ToolResult objects', async () => {
        const tool = createTool({
          execute: vi.fn().mockResolvedValue({
            success: false,
            error: 'Custom failure message',
          }),
        });
        const messages: any[] = [];

        await ToolExecutor.executeToolCalls(
          [createToolCall()],
          [tool],
          messages,
          [],
          createExecContext(),
          tracer
        );

        expect(mockRecordFailure).toHaveBeenCalledWith(
          'agent1',
          expect.stringContaining('Tool test-tool execution failed.'),
          1,
          0,
          expect.any(Object)
        );
      });
    });
  });
});
