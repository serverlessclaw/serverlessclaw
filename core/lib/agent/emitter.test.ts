import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend, mockPublishToRealtime, mockExtractBaseUserId } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockPublishToRealtime: vi.fn(),
  mockExtractBaseUserId: vi.fn((id: string) => id),
}));

import { AgentEmitter } from './emitter';
import { MessageRole } from '../types/index';

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@aws-sdk/client-eventbridge', () => {
  class MockEventBridgeClient {
    send = mockSend;
  }
  return {
    EventBridgeClient: MockEventBridgeClient,
    PutEventsCommand: class {
      constructor(public input: any) {}
    },
  };
});

vi.mock('sst', () => ({
  Resource: { AgentBus: { name: 'test-bus' } },
}));

vi.mock('../registry', () => ({
  AgentRegistry: { getRawConfig: vi.fn() },
}));

vi.mock('../providers/utils', () => ({
  parseConfigInt: (val: unknown, fallback: number) =>
    typeof val === 'number' ? val : Number(val) || fallback,
}));

vi.mock('../utils/agent-helpers', () => ({
  extractBaseUserId: (id: string) => mockExtractBaseUserId(id),
}));

vi.mock('../utils/realtime', () => ({
  publishToRealtime: (...args: unknown[]) => mockPublishToRealtime(...args),
}));

describe('AgentEmitter', () => {
  let emitter: AgentEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    emitter = new AgentEmitter({ id: 'agent1', name: 'TestAgent' } as any);
  });

  describe('considerReflection', () => {
    const baseArgs = {
      isIsolated: false,
      userId: 'user1',
      history: Array(25).fill({ role: MessageRole.USER, content: 'msg' }),
      userText: 'hello',
      traceId: 'trace1',
      messages: [{ role: MessageRole.USER, content: 'msg' }],
      responseText: 'response',
      nodeId: 'node1',
      parentId: undefined as string | undefined,
      sessionId: 'session1',
    };

    it('emits reflection when history length matches frequency', async () => {
      mockSend.mockResolvedValue({});
      await emitter.considerReflection(
        baseArgs.isIsolated,
        baseArgs.userId,
        baseArgs.history,
        baseArgs.userText,
        baseArgs.traceId,
        baseArgs.messages,
        baseArgs.responseText,
        baseArgs.nodeId,
        baseArgs.parentId,
        baseArgs.sessionId
      );
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('skips reflection when isolated', async () => {
      await emitter.considerReflection(
        true,
        baseArgs.userId,
        baseArgs.history,
        baseArgs.userText,
        baseArgs.traceId,
        baseArgs.messages,
        baseArgs.responseText,
        baseArgs.nodeId,
        baseArgs.parentId,
        baseArgs.sessionId
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('skips reflection when history is empty', async () => {
      await emitter.considerReflection(
        false,
        baseArgs.userId,
        [],
        baseArgs.userText,
        baseArgs.traceId,
        baseArgs.messages,
        baseArgs.responseText,
        baseArgs.nodeId,
        baseArgs.parentId,
        baseArgs.sessionId
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('triggers reflection on "remember" keyword', async () => {
      mockSend.mockResolvedValue({});
      await emitter.considerReflection(
        false,
        baseArgs.userId,
        [{ role: MessageRole.USER, content: 'msg' }],
        'please remember this',
        baseArgs.traceId,
        baseArgs.messages,
        baseArgs.responseText,
        baseArgs.nodeId,
        baseArgs.parentId,
        baseArgs.sessionId
      );
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('triggers reflection on "learn" keyword', async () => {
      mockSend.mockResolvedValue({});
      await emitter.considerReflection(
        false,
        baseArgs.userId,
        [{ role: MessageRole.USER, content: 'msg' }],
        'I want to learn something',
        baseArgs.traceId,
        baseArgs.messages,
        baseArgs.responseText,
        baseArgs.nodeId,
        baseArgs.parentId,
        baseArgs.sessionId
      );
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('handles EventBridge send failure gracefully', async () => {
      mockSend.mockRejectedValue(new Error('EB down'));
      await expect(
        emitter.considerReflection(
          false,
          baseArgs.userId,
          baseArgs.history,
          baseArgs.userText,
          baseArgs.traceId,
          baseArgs.messages,
          baseArgs.responseText,
          baseArgs.nodeId,
          baseArgs.parentId,
          baseArgs.sessionId
        )
      ).resolves.not.toThrow();
      const { logger } = await import('../logger');
      expect(logger.error).toHaveBeenCalled();
    });

    it('skips reflection when history length does not match frequency', async () => {
      await emitter.considerReflection(
        false,
        baseArgs.userId,
        [{ role: MessageRole.USER, content: 'msg' }],
        'hello',
        baseArgs.traceId,
        baseArgs.messages,
        baseArgs.responseText,
        baseArgs.nodeId,
        baseArgs.parentId,
        baseArgs.sessionId
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('uses agent name in reflection message', async () => {
      mockSend.mockResolvedValue({});
      await emitter.considerReflection(
        false,
        baseArgs.userId,
        baseArgs.history,
        baseArgs.userText,
        baseArgs.traceId,
        baseArgs.messages,
        baseArgs.responseText,
        baseArgs.nodeId,
        baseArgs.parentId,
        baseArgs.sessionId
      );
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('uses default agent name when no config', async () => {
      const defaultEmitter = new AgentEmitter();
      mockSend.mockResolvedValue({});
      await defaultEmitter.considerReflection(
        false,
        baseArgs.userId,
        baseArgs.history,
        baseArgs.userText,
        baseArgs.traceId,
        baseArgs.messages,
        baseArgs.responseText,
        baseArgs.nodeId,
        baseArgs.parentId,
        baseArgs.sessionId
      );
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('emitContinuation', () => {
    it('emits continuation event to EventBridge', async () => {
      mockSend.mockResolvedValue({});
      await emitter.emitContinuation('user1', 'continue task', 'trace1', {
        depth: 2,
        sessionId: 'session1',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('includes continuation metadata', async () => {
      mockSend.mockResolvedValue({});
      await emitter.emitContinuation('user1', 'task', 'trace1', {
        depth: 0,
        nodeId: 'node1',
        parentId: 'parent1',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('handles send failure gracefully', async () => {
      mockSend.mockRejectedValue(new Error('EB down'));
      await expect(emitter.emitContinuation('user1', 'task', 'trace1', {})).resolves.not.toThrow();
    });

    it('defaults depth to 1 when not provided', async () => {
      mockSend.mockResolvedValue({});
      await emitter.emitContinuation('user1', 'task', 'trace1', {});
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('increments depth by 1', async () => {
      mockSend.mockResolvedValue({});
      await emitter.emitContinuation('user1', 'task', 'trace1', { depth: 3 });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('uses agent config id as source', async () => {
      mockSend.mockResolvedValue({});
      await emitter.emitContinuation('user1', 'task', 'trace1', {});
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('uses default source when no config', async () => {
      const defaultEmitter = new AgentEmitter();
      mockSend.mockResolvedValue({});
      await defaultEmitter.emitContinuation('user1', 'task', 'trace1', {});
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('includes attachments in metadata', async () => {
      mockSend.mockResolvedValue({});
      const attachments = [{ type: 'image' as any, url: 'http://img.png' }];
      await emitter.emitContinuation('user1', 'task', 'trace1', { attachments });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('emitChunk', () => {
    it('publishes to correct MQTT topic with session', async () => {
      mockPublishToRealtime.mockResolvedValue(undefined);
      await emitter.emitChunk(
        'user1',
        'session1',
        'trace1',
        'hello',
        undefined,
        false,
        undefined,
        'orchestrator'
      );
      expect(mockPublishToRealtime).toHaveBeenCalledTimes(1);
      expect(mockPublishToRealtime.mock.calls[0][0]).toBe('users/user1/sessions/session1/signal');
    });

    it('publishes to topic without session', async () => {
      mockPublishToRealtime.mockResolvedValue(undefined);
      await emitter.emitChunk(
        'user1',
        undefined,
        'trace1',
        'hello',
        undefined,
        false,
        undefined,
        'orchestrator'
      );
      expect(mockPublishToRealtime.mock.calls[0][0]).toBe('users/user1/signal');
    });

    it('sanitizes special characters in userId for MQTT', async () => {
      mockExtractBaseUserId.mockReturnValue('user+1#test');
      mockPublishToRealtime.mockResolvedValue(undefined);
      await emitter.emitChunk(
        'user+1#test',
        'session1',
        'trace1',
        'hello',
        undefined,
        false,
        undefined,
        'orchestrator'
      );
      const topic = mockPublishToRealtime.mock.calls[0][0];
      expect(topic).toBe('users/user_1_test/sessions/session1/signal');
    });

    it('uses traceId as messageId for superclaw agent', async () => {
      mockPublishToRealtime.mockResolvedValue(undefined);
      const superEmitter = new AgentEmitter({ id: 'superclaw', name: 'SuperClaw' } as any);
      await superEmitter.emitChunk(
        'user1',
        'session1',
        'trace1',
        'hello',
        undefined,
        false,
        undefined,
        'orchestrator'
      );
      const payload = mockPublishToRealtime.mock.calls[0][1];
      expect(payload.messageId).toBe('trace1');
    });

    it('uses traceId as messageId for root agents (orchestrator)', async () => {
      mockPublishToRealtime.mockResolvedValue(undefined);
      await emitter.emitChunk(
        'user1',
        'session1',
        'trace1',
        'hello',
        undefined,
        false,
        undefined,
        'orchestrator'
      );
      const payload = mockPublishToRealtime.mock.calls[0][1];
      expect(payload.messageId).toBe('trace1');
    });

    it('uses traceId-agentId as messageId for worker agents (no superclaw/orchestrator)', async () => {
      mockPublishToRealtime.mockResolvedValue(undefined);
      await emitter.emitChunk(
        'user1',
        'session1',
        'trace1',
        'hello',
        undefined,
        false,
        undefined,
        'planner'
      );
      const payload = mockPublishToRealtime.mock.calls[0][1];
      expect(payload.messageId).toBe('trace1-agent1');
    });

    it('handles publish failure gracefully', async () => {
      mockPublishToRealtime.mockRejectedValue(new Error('IoT down'));
      await expect(
        emitter.emitChunk(
          'user1',
          'session1',
          'trace1',
          'hello',
          undefined,
          false,
          undefined,
          'orchestrator'
        )
      ).resolves.not.toThrow();
    });

    it('includes chunk content in payload', async () => {
      mockPublishToRealtime.mockResolvedValue(undefined);
      await emitter.emitChunk(
        'user1',
        'session1',
        'trace1',
        'test message',
        undefined,
        false,
        undefined,
        'orchestrator'
      );
      const payload = mockPublishToRealtime.mock.calls[0][1];
      expect(payload.message).toBe('test message');
    });

    it('includes isThought flag', async () => {
      mockPublishToRealtime.mockResolvedValue(undefined);
      await emitter.emitChunk(
        'user1',
        'session1',
        'trace1',
        'thinking...',
        undefined,
        true,
        undefined,
        'orchestrator'
      );
      const payload = mockPublishToRealtime.mock.calls[0][1];
      expect(payload.isThought).toBe(true);
    });

    it('includes options buttons', async () => {
      mockPublishToRealtime.mockResolvedValue(undefined);
      const options = [{ label: 'Yes', value: 'yes' }];
      await emitter.emitChunk(
        'user1',
        'session1',
        'trace1',
        'confirm?',
        undefined,
        false,
        options,
        'orchestrator'
      );
      const payload = mockPublishToRealtime.mock.calls[0][1];
      expect(payload.options).toEqual(options);
    });

    it('uses default agent name when no config', async () => {
      const defaultEmitter = new AgentEmitter();
      mockPublishToRealtime.mockResolvedValue(undefined);
      await defaultEmitter.emitChunk(
        'user1',
        'session1',
        'trace1',
        'hello',
        undefined,
        false,
        undefined,
        'orchestrator'
      );
      const payload = mockPublishToRealtime.mock.calls[0][1];
      expect(payload.agentName).toBe('SuperClaw');
    });

    it('uses traceId as messageId for unknown root agent (orchestrator)', async () => {
      const defaultEmitter = new AgentEmitter();
      mockPublishToRealtime.mockResolvedValue(undefined);
      await defaultEmitter.emitChunk(
        'user1',
        'session1',
        'trace1',
        'hello',
        undefined,
        false,
        undefined,
        'orchestrator'
      );
      const payload = mockPublishToRealtime.mock.calls[0][1];
      expect(payload.messageId).toBe('trace1');
    });

    it('includes correct detail-type', async () => {
      mockPublishToRealtime.mockResolvedValue(undefined);
      await emitter.emitChunk(
        'user1',
        'session1',
        'trace1',
        'hello',
        undefined,
        false,
        undefined,
        'orchestrator'
      );
      const payload = mockPublishToRealtime.mock.calls[0][1];
      expect(payload['detail-type']).toBe('chunk');
    });
  });
});
