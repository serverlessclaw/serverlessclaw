import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../lib/types/agent', () => ({
  EventType: {
    SYSTEM_HEALTH_REPORT: 'system_health_report',
  },
}));

const { mockTakeSnapshot, mockEmitEvent } = vi.hoisted(() => ({
  mockTakeSnapshot: vi.fn(),
  mockEmitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/metrics/cognitive-metrics', () => ({
  CognitiveHealthMonitor: vi.fn().mockImplementation(function () {
    return { takeSnapshot: mockTakeSnapshot };
  }),
}));

vi.mock('../../lib/memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}));

import { handleCognitiveHealthCheck } from './cognitive-health-handler';
import { logger } from '../../lib/logger';

describe('cognitive-health-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTakeSnapshot.mockReset();
    mockEmitEvent.mockReset();
    mockEmitEvent.mockResolvedValue(undefined);
  });

  it('should log snapshot info when health is good', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 90,
      anomalies: [],
      agentMetrics: [],
    });

    await handleCognitiveHealthCheck({});

    expect(mockTakeSnapshot).toHaveBeenCalledWith(undefined);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('score=90'));
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it('should not emit alert when score is above 70', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 75,
      anomalies: [],
      agentMetrics: [],
    });

    await handleCognitiveHealthCheck({});

    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it('should not emit alert when score is exactly 70', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 70,
      anomalies: [],
      agentMetrics: [],
    });

    await handleCognitiveHealthCheck({});

    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it('should emit alert when score is below 70', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 60,
      anomalies: [{ severity: 'low' }],
      agentMetrics: [{ agentId: 'coder', taskCompletionRate: 0.5, errorRate: 0.3 }],
    });

    await handleCognitiveHealthCheck({});

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Cognitive health degraded'));
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'cognitive-health',
      'system_health_report',
      expect.objectContaining({
        component: 'CognitiveHealthMonitor',
        severity: 'high',
      })
    );
  });

  it('should emit critical alert when score is below 50', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 40,
      anomalies: [{ severity: 'critical' }, { severity: 'high' }],
      agentMetrics: [],
    });

    await handleCognitiveHealthCheck({});

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'cognitive-health',
      'system_health_report',
      expect.objectContaining({
        severity: 'critical',
      })
    );
  });

  it('should filter critical and high anomalies', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 50,
      anomalies: [
        { severity: 'critical' },
        { severity: 'high' },
        { severity: 'low' },
        { severity: 'medium' },
      ],
      agentMetrics: [],
    });

    await handleCognitiveHealthCheck({});

    const call = mockEmitEvent.mock.calls[0][2];
    expect(call.context.criticalCount).toBe(2);
    expect(call.context.anomalyCount).toBe(4);
  });

  it('should pass agentIds from eventDetail', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 90,
      anomalies: [],
      agentMetrics: [],
    });

    await handleCognitiveHealthCheck({ agentIds: ['agent1', 'agent2'] });

    expect(mockTakeSnapshot).toHaveBeenCalledWith(['agent1', 'agent2']);
  });

  it('should include agent metrics in alert context', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 50,
      anomalies: [],
      agentMetrics: [
        { agentId: 'coder', taskCompletionRate: 0.8, errorRate: 0.1 },
        { agentId: 'qa', taskCompletionRate: 0.9, errorRate: 0.05 },
      ],
    });

    await handleCognitiveHealthCheck({});

    const call = mockEmitEvent.mock.calls[0][2];
    expect(call.context.agentMetrics).toEqual([
      { agentId: 'coder', completionRate: 0.8, errorRate: 0.1 },
      { agentId: 'qa', completionRate: 0.9, errorRate: 0.05 },
    ]);
  });

  it('should include overallScore and anomalyCount in alert context', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 30,
      anomalies: [{ severity: 'critical' }],
      agentMetrics: [],
    });

    await handleCognitiveHealthCheck({});

    const call = mockEmitEvent.mock.calls[0][2];
    expect(call.context.overallScore).toBe(30);
    expect(call.context.anomalyCount).toBe(1);
  });

  it('should include score in issue message', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 45,
      anomalies: [{ severity: 'critical' }],
      agentMetrics: [],
    });

    await handleCognitiveHealthCheck({});

    const call = mockEmitEvent.mock.calls[0][2];
    expect(call.issue).toContain('45/100');
    expect(call.issue).toContain('1 critical anomalies detected');
  });

  it('should handle emitEvent failure gracefully', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 50,
      anomalies: [{ severity: 'critical' }],
      agentMetrics: [],
    });
    mockEmitEvent.mockRejectedValueOnce(new Error('Bus down'));

    await expect(handleCognitiveHealthCheck({})).resolves.not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to emit cognitive health alert:',
      expect.any(Error)
    );
  });

  it('should handle empty agentIds array', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 90,
      anomalies: [],
      agentMetrics: [],
    });

    await handleCognitiveHealthCheck({ agentIds: [] });

    expect(mockTakeSnapshot).toHaveBeenCalledWith([]);
  });

  it('should handle agentMetrics with zero error rate', async () => {
    mockTakeSnapshot.mockResolvedValueOnce({
      overallScore: 50,
      anomalies: [],
      agentMetrics: [{ agentId: 'a1', taskCompletionRate: 1.0, errorRate: 0 }],
    });

    await handleCognitiveHealthCheck({});

    const call = mockEmitEvent.mock.calls[0][2];
    expect(call.context.agentMetrics[0].errorRate).toBe(0);
  });
});
