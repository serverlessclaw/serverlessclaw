import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventType } from '../types/index';

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockEmitEvent = vi.fn();
vi.mock('./bus', () => ({
  emitEvent: (...args: any[]) => mockEmitEvent(...args),
}));

vi.mock('../schema/events', () => ({
  EVENT_SCHEMA_MAP: {
    task_completed: {
      parse: (data: unknown) => {
        const obj = data as Record<string, unknown>;
        if (typeof obj.response !== 'string') {
          throw new Error('Validation error: response must be a string');
        }
        return { ...obj, response: obj.response };
      },
    },
  },
  CompletionEventPayload: {},
  FailureEventPayload: {},
  OutboundMessageEventPayload: {},
  HealthReportEventPayload: {},
  ProactiveHeartbeatPayloadInferred: {},
}));

import {
  emitTypedEvent,
  emitTypedEventSafe,
  emitTaskCompleted,
  emitTaskFailed,
  emitOutboundMessage,
  emitHealthReport,
  emitProactiveHeartbeat,
} from './typed-emit';

describe('typed-emit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmitEvent.mockReset();
  });

  describe('emitTypedEvent', () => {
    it('should validate and emit event with schema', async () => {
      mockEmitEvent.mockResolvedValue({ success: true, eventId: 'evt-1' });

      const result = await emitTypedEvent('test', EventType.TASK_COMPLETED, {
        response: 'done',
      });

      expect(result.success).toBe(true);
      expect(result.eventId).toBe('evt-1');
      expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    });

    it('should emit without validation when no schema exists', async () => {
      mockEmitEvent.mockResolvedValue({ success: true, eventId: 'evt-2' });

      const result = await emitTypedEvent('test', 'unknown_event_type', { data: 'test' });

      expect(result.success).toBe(true);
      expect(mockEmitEvent).toHaveBeenCalledWith(
        'test',
        'unknown_event_type',
        { data: 'test' },
        {}
      );
    });

    it('should throw on validation failure', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await expect(
        emitTypedEvent('test', EventType.TASK_COMPLETED, { response: 123 })
      ).rejects.toThrow();
    });

    it('should pass options to emitEvent', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await emitTypedEvent(
        'test',
        EventType.TASK_COMPLETED,
        { response: 'ok' },
        {
          maxRetries: 5,
        }
      );

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'test',
        EventType.TASK_COMPLETED,
        expect.any(Object),
        { maxRetries: 5 }
      );
    });

    it('should handle string event types with schema', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      const result = await emitTypedEvent('test', 'task_completed', {
        response: 'done',
      });

      expect(result.success).toBe(true);
    });

    it('should pass validated detail to emitEvent', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await emitTypedEvent('source', EventType.TASK_COMPLETED, {
        response: 'test response',
      });

      const callArgs = mockEmitEvent.mock.calls[0];
      expect(callArgs[0]).toBe('source');
      expect(callArgs[1]).toBe(EventType.TASK_COMPLETED);
      expect(callArgs[2].response).toBe('test response');
    });

    it('should log error and rethrow on validation failure', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await expect(
        emitTypedEvent('src', EventType.TASK_COMPLETED, { response: 123 })
      ).rejects.toThrow();
    });
  });

  describe('emitTypedEventSafe', () => {
    it('should emit successfully on valid payload', async () => {
      mockEmitEvent.mockResolvedValue({ success: true, eventId: 'evt-3' });

      const result = await emitTypedEventSafe('test', EventType.TASK_COMPLETED, {
        response: 'done',
      });

      expect(result.success).toBe(true);
    });

    it('should fall back to raw emit on validation failure', async () => {
      mockEmitEvent.mockResolvedValue({ success: true, eventId: 'evt-4' });

      const result = await emitTypedEventSafe('test', EventType.TASK_COMPLETED, {
        response: 123,
      });

      expect(result.success).toBe(true);
      expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    });

    it('should emit raw event without schema', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      const result = await emitTypedEventSafe('test', 'custom_event', { foo: 'bar' });

      expect(result.success).toBe(true);
    });

    it('should not throw on validation failure', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      const result = await emitTypedEventSafe('test', EventType.TASK_COMPLETED, {
        response: 123,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('emitTaskCompleted', () => {
    it('should emit TASK_COMPLETED event', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await emitTaskCompleted('agent', { response: 'completed' });

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'agent',
        EventType.TASK_COMPLETED,
        expect.objectContaining({ response: 'completed' }),
        {}
      );
    });

    it('should pass options through', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await emitTaskCompleted('agent', { response: 'ok' }, { maxRetries: 3 });

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'agent',
        EventType.TASK_COMPLETED,
        expect.any(Object),
        { maxRetries: 3 }
      );
    });
  });

  describe('emitTaskFailed', () => {
    it('should emit TASK_FAILED event', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await emitTaskFailed('agent', { error: 'failed' });

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'agent',
        EventType.TASK_FAILED,
        expect.objectContaining({ error: 'failed' }),
        {}
      );
    });

    it('should pass options through', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await emitTaskFailed('agent', { error: 'failed' }, { maxRetries: 2 });

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'agent',
        EventType.TASK_FAILED,
        expect.any(Object),
        { maxRetries: 2 }
      );
    });
  });

  describe('emitOutboundMessage', () => {
    it('should emit OUTBOUND_MESSAGE event', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await emitOutboundMessage('agent', { message: 'hello' });

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'agent',
        EventType.OUTBOUND_MESSAGE,
        expect.objectContaining({ message: 'hello' }),
        {}
      );
    });

    it('should pass options through', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await emitOutboundMessage('agent', { message: 'hello' }, { correlationId: 'corr-1' });

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'agent',
        EventType.OUTBOUND_MESSAGE,
        expect.any(Object),
        { correlationId: 'corr-1' }
      );
    });
  });

  describe('emitHealthReport', () => {
    it('should emit SYSTEM_HEALTH_REPORT event', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await emitHealthReport('monitor', {
        component: 'db',
        issue: 'slow',
        severity: 'WARNING' as any,
      });

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'monitor',
        EventType.SYSTEM_HEALTH_REPORT,
        expect.objectContaining({ component: 'db', issue: 'slow', severity: 'WARNING' }),
        {}
      );
    });
  });

  describe('emitProactiveHeartbeat', () => {
    it('should emit HEARTBEAT_PROACTIVE event', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await emitProactiveHeartbeat('scheduler', { goalId: 'goal-1' });

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'scheduler',
        EventType.HEARTBEAT_PROACTIVE,
        expect.objectContaining({ goalId: 'goal-1' }),
        {}
      );
    });

    it('should pass options through', async () => {
      mockEmitEvent.mockResolvedValue({ success: true });

      await emitProactiveHeartbeat('scheduler', { goalId: 'goal-1' }, { priority: 'HIGH' as any });

      expect(mockEmitEvent).toHaveBeenCalledWith(
        'scheduler',
        EventType.HEARTBEAT_PROACTIVE,
        expect.any(Object),
        { priority: 'HIGH' }
      );
    });
  });
});
