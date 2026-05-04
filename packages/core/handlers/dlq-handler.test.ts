/**
 * @module DLQ Handler Tests
 * @description Tests for Dead Letter Queue event replay including
 * re-emission, error handling, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './dlq-handler';
import { EventType, AGENT_TYPES } from '../lib/types/agent';

const mockEmitTypedEvent = vi.fn();
const mockReportHealthIssue = vi.fn();
const mockStoreInDLQ = vi.fn();

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../lib/utils/typed-emit', () => ({
  emitTypedEvent: (...args: unknown[]) => mockEmitTypedEvent(...args),
}));

vi.mock('./events/shared', () => ({
  reportHealthIssue: (...args: unknown[]) => mockReportHealthIssue(...args),
}));

vi.mock('../lib/utils/bus/dlq', () => ({
  storeInDLQ: (...args: unknown[]) => mockStoreInDLQ(...args),
}));

vi.mock('../lib/utils/bus/types', () => ({
  EventPriority: { CRITICAL: 'CRITICAL', HIGH: 'HIGH', NORMAL: 'NORMAL' },
}));

function createSQSEvent(
  records: Array<{ messageId?: string; body: string }>
): Parameters<typeof handler>[0] {
  return {
    Records: records.map((r) => ({
      messageId: r.messageId ?? 'msg-1',
      body: r.body,
      attributes: {},
      messageAttributes: {},
    })),
  };
}

describe('DLQ Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmitTypedEvent.mockResolvedValue(undefined);
  });

  it('re-emits a single event successfully', async () => {
    const event = createSQSEvent([
      {
        body: JSON.stringify({
          'detail-type': EventType.CODER_TASK,
          detail: { task: 'write code', sourceAgent: AGENT_TYPES.CODER },
        }),
      },
    ]);

    await handler(event, {} as any);

    expect(mockEmitTypedEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitTypedEvent).toHaveBeenCalledWith(
      AGENT_TYPES.CODER,
      EventType.CODER_TASK,
      expect.objectContaining({ task: 'write code' })
    );
  });

  it('processes multiple records', async () => {
    const event = createSQSEvent([
      {
        body: JSON.stringify({
          'detail-type': EventType.CODER_TASK,
          detail: { sourceAgent: AGENT_TYPES.CODER },
        }),
      },
      {
        body: JSON.stringify({
          'detail-type': EventType.REFLECT_TASK,
          detail: { sourceAgent: AGENT_TYPES.COGNITION_REFLECTOR },
        }),
      },
    ]);

    await handler(event, {} as any);

    expect(mockEmitTypedEvent).toHaveBeenCalledTimes(2);
  });

  it('continues processing other records when one fails', async () => {
    mockEmitTypedEvent
      .mockRejectedValueOnce(new Error('emit failed'))
      .mockResolvedValueOnce(undefined);

    const event = createSQSEvent([
      { body: JSON.stringify({ 'detail-type': 'event1', detail: {} }) },
      { body: JSON.stringify({ 'detail-type': 'event2', detail: {} }) },
    ]);

    await handler(event, {} as any);

    expect(mockEmitTypedEvent).toHaveBeenCalledTimes(2);
    const { logger } = await import('../lib/logger');
    expect(logger.error).toHaveBeenCalled();
  });

  it('handles malformed JSON body gracefully', async () => {
    const event = createSQSEvent([{ body: 'not valid json' }]);

    await handler(event, {} as any);

    expect(mockEmitTypedEvent).not.toHaveBeenCalled();
    const { logger } = await import('../lib/logger');
    expect(logger.error).toHaveBeenCalled();
  });

  it('defaults detail-type to Unknown when missing', async () => {
    const event = createSQSEvent([{ body: JSON.stringify({ detail: {} }) }]);

    await handler(event, {} as any);

    expect(mockEmitTypedEvent).toHaveBeenCalledWith(
      AGENT_TYPES.SUPERCLAW,
      'Unknown' as EventType,
      expect.any(Object)
    );
  });

  it('defaults sourceAgent to SUPERCLAW when missing', async () => {
    const event = createSQSEvent([
      { body: JSON.stringify({ 'detail-type': 'some_event', detail: {} }) },
    ]);

    await handler(event, {} as any);

    expect(mockEmitTypedEvent).toHaveBeenCalledWith(
      AGENT_TYPES.SUPERCLAW,
      'some_event' as EventType,
      expect.any(Object)
    );
  });

  it('handles empty Records array', async () => {
    const event = createSQSEvent([]);

    await handler(event, {} as any);

    expect(mockEmitTypedEvent).not.toHaveBeenCalled();
  });

  it('handles missing detail field', async () => {
    const event = createSQSEvent([
      { body: JSON.stringify({ 'detail-type': EventType.CODER_TASK }) },
    ]);

    await handler(event, {} as any);

    expect(mockEmitTypedEvent).toHaveBeenCalledWith(AGENT_TYPES.SUPERCLAW, EventType.CODER_TASK, {
      replayCount: 1,
    });
  });

  it('stores event permanently in DLQ when max replay attempts are exceeded', async () => {
    const event = createSQSEvent([
      {
        body: JSON.stringify({
          'detail-type': EventType.CODER_TASK,
          detail: { task: 'write code', replayCount: 3, sourceAgent: AGENT_TYPES.CODER },
        }),
      },
    ]);

    await handler(event, {} as any);

    expect(mockEmitTypedEvent).not.toHaveBeenCalled();
    expect(mockReportHealthIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'DLQHandler',
        severity: 'critical',
      })
    );
    expect(mockStoreInDLQ).toHaveBeenCalledWith(
      'DLQHandler',
      EventType.CODER_TASK,
      expect.objectContaining({ task: 'write code', replayCount: 3 }),
      expect.objectContaining({
        retryCount: 3,
        maxRetries: 3,
        priority: 'CRITICAL',
      }),
      'msg-1'
    );
  });
});
