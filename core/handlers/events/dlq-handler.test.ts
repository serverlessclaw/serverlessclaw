import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDlqRoute } from './dlq-handler';
import { EventType } from '../../lib/types/agent';

const reportHealthIssue = vi.fn();

vi.mock('../../lib/lifecycle/health', () => ({
  reportHealthIssue: (...args: unknown[]) => reportHealthIssue(...args),
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('handleDlqRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suppresses health re-report for recursion-rerouted system_health_report', async () => {
    await handleDlqRoute(
      {
        detailType: EventType.SYSTEM_HEALTH_REPORT,
        errorMessage: 'Recursion limit exceeded',
        userId: 'SYSTEM',
        traceId: 'trace-loop',
        originalEvent: { x: 1 },
      },
      EventType.DLQ_ROUTE
    );

    expect(reportHealthIssue).not.toHaveBeenCalled();
  });

  it('reports health issue for non-recursion DLQ events', async () => {
    await handleDlqRoute(
      {
        detailType: EventType.DASHBOARD_FAILURE_DETECTED,
        errorMessage: 'handler import failed',
        userId: 'SYSTEM',
        traceId: 'trace-1',
        originalEvent: { dashboard: true },
      },
      EventType.DLQ_ROUTE
    );

    expect(reportHealthIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.stringContaining('Routed event to DLQ: dashboard_failure_detected'),
        traceId: 'trace-1',
      })
    );
  });
});
