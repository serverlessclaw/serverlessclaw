import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeToDlq } from './route-to-dlq';
import { EventType } from '../lib/types/agent';

const mockEmitEvent = vi.fn();
const mockReportHealthIssue = vi.fn();

vi.mock('../lib/utils/bus', () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}));

vi.mock('../lib/lifecycle/health', () => ({
  reportHealthIssue: (...args: unknown[]) => mockReportHealthIssue(...args),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('routeToDlq', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a DLQ_ROUTE event for non-DLQ detail types', async () => {
    await routeToDlq(
      {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: { sessionId: 's1', traceId: 't1' },
        id: 'e1',
      },
      EventType.SYSTEM_HEALTH_REPORT,
      'SYSTEM',
      't1',
      'test error',
      's1'
    );

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'events.handler',
      EventType.DLQ_ROUTE,
      expect.objectContaining({
        detailType: EventType.SYSTEM_HEALTH_REPORT,
        traceId: 't1',
        sessionId: 's1',
        observability: expect.objectContaining({
          sessionId: 's1',
          detailType: EventType.SYSTEM_HEALTH_REPORT,
        }),
      })
    );
    expect(mockReportHealthIssue).not.toHaveBeenCalled();
  });

  it('falls back to event.detail.sessionId when explicit sessionId is not provided', async () => {
    await routeToDlq(
      {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: { sessionId: 'fallback-session', traceId: 't-fallback' },
        id: 'e3',
      },
      EventType.SYSTEM_HEALTH_REPORT,
      'SYSTEM',
      't-fallback',
      'fallback test'
    );

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'events.handler',
      EventType.DLQ_ROUTE,
      expect.objectContaining({
        sessionId: 'fallback-session',
        observability: expect.objectContaining({
          sessionId: 'fallback-session',
        }),
      })
    );
  });

  it('prevents recursive DLQ routing for DLQ_ROUTE detail type', async () => {
    await routeToDlq(
      {
        'detail-type': EventType.DLQ_ROUTE,
        detail: { sessionId: 's1', traceId: 't1' },
        id: 'e2',
      },
      EventType.DLQ_ROUTE,
      'SYSTEM',
      't1',
      'already dlq',
      's1'
    );

    expect(mockEmitEvent).not.toHaveBeenCalled();
    expect(mockReportHealthIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: 'Prevented recursive DLQ_ROUTE self-routing loop',
        traceId: 't1',
      })
    );
  });

  it('uses system-spine when no session id is available anywhere', async () => {
    await routeToDlq(
      {
        'detail-type': EventType.SYSTEM_HEALTH_REPORT,
        detail: { traceId: 't-no-session' },
        id: 'e4',
      },
      EventType.SYSTEM_HEALTH_REPORT,
      'SYSTEM',
      't-no-session',
      'missing session context'
    );

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'events.handler',
      EventType.DLQ_ROUTE,
      expect.objectContaining({
        sessionId: 'system-spine',
        observability: expect.objectContaining({
          sessionId: 'system-spine',
        }),
      })
    );
  });

  it('reports health issue and throws when DLQ emit fails', async () => {
    mockEmitEvent.mockRejectedValueOnce(new Error('eventbridge down'));

    await expect(
      routeToDlq(
        {
          'detail-type': EventType.SYSTEM_HEALTH_REPORT,
          detail: { sessionId: 's5', traceId: 't5' },
          id: 'e5',
        },
        EventType.SYSTEM_HEALTH_REPORT,
        'SYSTEM',
        't5',
        'emit failure'
      )
    ).rejects.toThrow('Unhandled event type: system_health_report');

    expect(mockReportHealthIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.stringContaining('Failed to route unhandled event to DLQ'),
        traceId: 't5',
      })
    );
  });
});
