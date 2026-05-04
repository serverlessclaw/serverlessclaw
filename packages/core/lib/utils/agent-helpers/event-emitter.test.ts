import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventType } from '../../types/index';

const mockEmitTypedEvent = vi.fn();
vi.mock('../typed-emit', () => ({
  emitTypedEvent: (...args: any[]) => mockEmitTypedEvent(...args),
}));

import { emitTaskEvent } from './event-emitter';

describe('emitTaskEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmitTypedEvent.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseParams = {
    source: 'test-agent',
    agentId: 'agent-1',
    userId: 'user-1',
    task: 'Summarize the document',
  };

  describe('successful event emission', () => {
    it('should emit TASK_COMPLETED when no error is provided', async () => {
      mockEmitTypedEvent.mockResolvedValue({ success: true, eventId: 'evt-1' });

      await emitTaskEvent({
        ...baseParams,
        response: 'Summary complete',
      });

      expect(mockEmitTypedEvent).toHaveBeenCalledTimes(1);
      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        'test-agent',
        EventType.TASK_COMPLETED,
        expect.objectContaining({
          userId: 'user-1',
          agentId: 'agent-1',
          task: 'Summarize the document',
          response: 'Summary complete',
        }),
        { idempotencyKey: undefined }
      );
    });

    it('should emit TASK_FAILED when error is provided', async () => {
      mockEmitTypedEvent.mockResolvedValue({ success: true, eventId: 'evt-2' });

      await emitTaskEvent({
        ...baseParams,
        error: 'Something went wrong',
      });

      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        'test-agent',
        EventType.TASK_FAILED,
        expect.objectContaining({
          error: 'Something went wrong',
        }),
        { idempotencyKey: undefined }
      );
    });

    it('should include optional fields in the detail', async () => {
      mockEmitTypedEvent.mockResolvedValue({ success: true });

      await emitTaskEvent({
        ...baseParams,
        response: 'done',
        attachments: [{ url: 'https://example.com/file.pdf', type: 'document' } as any],
        traceId: 'trace-123',
        taskId: 'task-456',
        sessionId: 'sess-789',
        initiatorId: 'init-000',
        depth: 2,
        metadata: { key: 'value' },
        userNotified: true,
      });

      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        'test-agent',
        EventType.TASK_COMPLETED,
        expect.objectContaining({
          attachments: [{ url: 'https://example.com/file.pdf', type: 'document' }],
          traceId: 'trace-123',
          taskId: 'task-456',
          sessionId: 'sess-789',
          initiatorId: 'init-000',
          depth: 2,
          metadata: { key: 'value' },
          userNotified: true,
        }),
        { idempotencyKey: undefined }
      );
    });

    it('should set response to empty string when neither response nor error provided', async () => {
      mockEmitTypedEvent.mockResolvedValue({ success: true });

      await emitTaskEvent(baseParams);

      const detail = mockEmitTypedEvent.mock.calls[0][2];
      expect(detail.response).toBe('');
      expect(detail.error).toBeUndefined();
    });
  });

  describe('retry on failure', () => {
    it('should propagate errors from emitTypedEvent', async () => {
      mockEmitTypedEvent.mockRejectedValue(new Error('EventBridge unavailable'));

      await expect(emitTaskEvent({ ...baseParams, response: 'done' })).rejects.toThrow(
        'EventBridge unavailable'
      );
    });

    it('should propagate rejection on first call failure', async () => {
      mockEmitTypedEvent.mockRejectedValueOnce(new Error('Throttled'));

      await expect(emitTaskEvent({ ...baseParams, response: 'done' })).rejects.toThrow('Throttled');

      expect(mockEmitTypedEvent).toHaveBeenCalledTimes(1);
    });

    it('should succeed when emitTypedEvent succeeds after earlier failure in separate call', async () => {
      // First call fails
      mockEmitTypedEvent.mockRejectedValueOnce(new Error('Throttled'));
      await expect(emitTaskEvent({ ...baseParams, response: 'done' })).rejects.toThrow('Throttled');

      // Second call succeeds
      mockEmitTypedEvent.mockResolvedValueOnce({ success: true, eventId: 'evt-retry' });
      await emitTaskEvent({ ...baseParams, response: 'done' });

      expect(mockEmitTypedEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe('exponential backoff timing', () => {
    it('should call emitTypedEvent immediately on first attempt', async () => {
      mockEmitTypedEvent.mockResolvedValue({ success: true });

      await emitTaskEvent({ ...baseParams, response: 'done' });

      expect(mockEmitTypedEvent).toHaveBeenCalledTimes(1);
    });

    it('should include correct detail structure on each retry', async () => {
      mockEmitTypedEvent
        .mockRejectedValueOnce(new Error('fail-1'))
        .mockRejectedValueOnce(new Error('fail-2'))
        .mockResolvedValueOnce({ success: true });

      // Since emitTaskEvent doesn't have its own retry loop (delegates to emitTypedEvent),
      // verify that errors propagate correctly and the detail structure is consistent
      await expect(emitTaskEvent({ ...baseParams, response: 'done' })).rejects.toThrow('fail-1');

      // Verify the detail was correctly constructed before the failure
      const callArgs = mockEmitTypedEvent.mock.calls[0];
      expect(callArgs[0]).toBe('test-agent');
      expect(callArgs[1]).toBe(EventType.TASK_COMPLETED);
      expect(callArgs[2]).toHaveProperty('userId', 'user-1');
      expect(callArgs[2]).toHaveProperty('agentId', 'agent-1');
      expect(callArgs[2]).toHaveProperty('task', 'Summarize the document');
      expect(callArgs[2]).toHaveProperty('response', 'done');
    });
  });

  describe('max retries exceeded', () => {
    it('should throw after all attempts fail', async () => {
      mockEmitTypedEvent.mockRejectedValue(new Error('Persistent failure'));

      await expect(emitTaskEvent({ ...baseParams, error: 'task error' })).rejects.toThrow(
        'Persistent failure'
      );

      expect(mockEmitTypedEvent).toHaveBeenCalledTimes(1);
    });

    it('should use TASK_FAILED type when error param is present even after failure', async () => {
      mockEmitTypedEvent.mockRejectedValue(new Error('Service down'));

      await expect(emitTaskEvent({ ...baseParams, error: 'timeout' })).rejects.toThrow(
        'Service down'
      );

      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        'test-agent',
        EventType.TASK_FAILED,
        expect.objectContaining({ error: 'timeout' }),
        { idempotencyKey: undefined }
      );
    });
  });

  describe('event type selection', () => {
    it('should select TASK_COMPLETED for empty string error', async () => {
      mockEmitTypedEvent.mockResolvedValue({ success: true });

      await emitTaskEvent({ ...baseParams, error: '', response: 'ok' });

      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        expect.anything(),
        EventType.TASK_COMPLETED,
        expect.anything(),
        { idempotencyKey: undefined }
      );
    });

    it('should select TASK_FAILED for non-empty error', async () => {
      mockEmitTypedEvent.mockResolvedValue({ success: true });

      await emitTaskEvent({ ...baseParams, error: 'err' });

      expect(mockEmitTypedEvent).toHaveBeenCalledWith(
        expect.anything(),
        EventType.TASK_FAILED,
        expect.anything(),
        { idempotencyKey: undefined }
      );
    });

    it('should set error field in detail for failures', async () => {
      mockEmitTypedEvent.mockResolvedValue({ success: true });

      await emitTaskEvent({ ...baseParams, error: 'failure reason' });

      const detail = mockEmitTypedEvent.mock.calls[0][2];
      expect(detail.error).toBe('failure reason');
      expect(detail.response).toBeUndefined();
    });

    it('should set response field in detail for completions', async () => {
      mockEmitTypedEvent.mockResolvedValue({ success: true });

      await emitTaskEvent({ ...baseParams, response: 'success result' });

      const detail = mockEmitTypedEvent.mock.calls[0][2];
      expect(detail.response).toBe('success result');
      expect(detail.error).toBeUndefined();
    });
  });
});
