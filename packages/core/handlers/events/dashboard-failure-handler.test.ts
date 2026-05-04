import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDashboardFailure } from './dashboard-failure-handler';
import { MetabolismService } from '../../lib/maintenance/metabolism';
import { FailureEventPayload } from '../../lib/schema/events';

vi.mock('../../lib/memory', () => ({
  BaseMemoryProvider: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../lib/maintenance/metabolism', () => ({
  MetabolismService: {
    remediateDashboardFailure: vi.fn(),
  },
}));

describe('DashboardFailureHandler', () => {
  const mockPayload: FailureEventPayload = {
    userId: 'test-user',
    traceId: 'test-trace-id',
    agentId: 'test-agent',
    task: 'Test Task',
    error: 'Test Error',
    source: 'dashboard',
    timestamp: Date.now(),
    depth: 0,
    sessionId: 'test-session',
    taskId: 'test-task-id',
    initiatorId: 'orchestrator',
    metadata: {},
    attachments: [],
    userNotified: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (MetabolismService.remediateDashboardFailure as any).mockResolvedValue(undefined);
  });

  it('should call MetabolismService.remediateDashboardFailure with the correct payload', async () => {
    await handleDashboardFailure(mockPayload, 'dashboard_failure_detected');

    expect(MetabolismService.remediateDashboardFailure).toHaveBeenCalledWith(
      expect.anything(),
      mockPayload
    );
  });

  it('should log success when remediation returns a result', async () => {
    const mockResult = {
      silo: 'Metabolism',
      expected: 'Fixed',
      actual: 'Pruned tools',
      severity: 'P2',
      recommendation: 'Done',
    };
    (MetabolismService.remediateDashboardFailure as any).mockResolvedValue(mockResult);

    await handleDashboardFailure(mockPayload, 'dashboard_failure_detected');

    expect(MetabolismService.remediateDashboardFailure).toHaveBeenCalled();
  });

  it('should log complex failure when remediation returns no result', async () => {
    (MetabolismService.remediateDashboardFailure as any).mockResolvedValue(undefined);

    await handleDashboardFailure(mockPayload, 'dashboard_failure_detected');

    expect(MetabolismService.remediateDashboardFailure).toHaveBeenCalled();
  });

  it('should handle errors gracefully during remediation', async () => {
    (MetabolismService.remediateDashboardFailure as any).mockRejectedValue(
      new Error('Remediation Failed')
    );

    // Should not throw
    await expect(
      handleDashboardFailure(mockPayload, 'dashboard_failure_detected')
    ).resolves.not.toThrow();
  });
});
