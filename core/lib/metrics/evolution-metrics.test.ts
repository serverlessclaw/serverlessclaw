import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EVOLUTION_METRICS } from './evolution-metrics';
import { emitMetrics } from './metrics';
import { logger } from '../logger';

vi.mock('./metrics', () => ({
  METRICS: {
    lockAcquired: vi.fn((lockId, success) => ({
      MetricName: 'LockAcquired',
      Value: success ? 1 : 0,
      Unit: 'Count',
      Dimensions: [{ Name: 'LockId', Value: lockId }],
    })),
  },
  emitMetrics: vi.fn().mockResolvedValue({}),
}));

vi.mock('../logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

describe('EVOLUTION_METRICS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordDuplicateSuppression', () => {
    it('emits EvolutionDuplicateSuppression metric', async () => {
      EVOLUTION_METRICS.recordDuplicateSuppression('test-source');

      expect(emitMetrics).toHaveBeenCalledWith([
        {
          MetricName: 'EvolutionDuplicateSuppression',
          Value: 1,
          Unit: 'Count',
          Dimensions: [{ Name: 'Source', Value: 'test-source' }],
        },
      ]);
    });

    it('logs warning if emitMetrics fails', async () => {
      const error = new Error('Failed');
      (emitMetrics as any).mockRejectedValueOnce(error);

      EVOLUTION_METRICS.recordDuplicateSuppression('test-source');

      // We need to wait for the promise in recordDuplicateSuppression to settle
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to emit EvolutionDuplicateSuppression metric:',
        error
      );
    });
  });

  describe('recordTransitionRejection', () => {
    it('emits EvolutionTransitionRejection metric', async () => {
      EVOLUTION_METRICS.recordTransitionRejection('gap-1', 'OPEN', 'CLOSED', 'invalid-guard');

      expect(emitMetrics).toHaveBeenCalledWith([
        {
          MetricName: 'EvolutionTransitionRejection',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'FromStatus', Value: 'OPEN' },
            { Name: 'ToStatus', Value: 'CLOSED' },
            { Name: 'Reason', Value: 'invalid-guard' },
          ],
        },
      ]);
    });

    it('logs warning if emitMetrics fails', async () => {
      const error = new Error('Failed');
      (emitMetrics as any).mockRejectedValueOnce(error);

      EVOLUTION_METRICS.recordTransitionRejection('gap-1', 'OPEN', 'CLOSED', 'invalid-guard');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to emit EvolutionTransitionRejection metric:',
        error
      );
    });
  });

  describe('recordBarrierTimeout', () => {
    it('emits EvolutionBarrierTimeout metric with completion rate', async () => {
      EVOLUTION_METRICS.recordBarrierTimeout('trace-1', 10, 5);

      expect(emitMetrics).toHaveBeenCalledWith([
        {
          MetricName: 'EvolutionBarrierTimeout',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'TaskCount', Value: '10' },
            { Name: 'CompletionRate', Value: '0.50' },
          ],
        },
      ]);
    });

    it('handles zero task count', async () => {
      EVOLUTION_METRICS.recordBarrierTimeout('trace-1', 0, 0);

      expect(emitMetrics).toHaveBeenCalledWith([
        {
          MetricName: 'EvolutionBarrierTimeout',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'TaskCount', Value: '0' },
            { Name: 'CompletionRate', Value: '0' },
          ],
        },
      ]);
    });

    it('logs warning if emitMetrics fails', async () => {
      const error = new Error('Failed');
      (emitMetrics as any).mockRejectedValueOnce(error);

      EVOLUTION_METRICS.recordBarrierTimeout('trace-1', 10, 5);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to emit EvolutionBarrierTimeout metric:',
        error
      );
    });
  });

  describe('recordGapReopen', () => {
    it('emits EvolutionGapReopen metric', async () => {
      EVOLUTION_METRICS.recordGapReopen('gap-1', 3);

      expect(emitMetrics).toHaveBeenCalledWith([
        {
          MetricName: 'EvolutionGapReopen',
          Value: 1,
          Unit: 'Count',
          Dimensions: [{ Name: 'AttemptCount', Value: '3' }],
        },
      ]);
    });

    it('logs warning if emitMetrics fails', async () => {
      const error = new Error('Failed');
      (emitMetrics as any).mockRejectedValueOnce(error);

      EVOLUTION_METRICS.recordGapReopen('gap-1', 3);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(logger.warn).toHaveBeenCalledWith('Failed to emit EvolutionGapReopen metric:', error);
    });
  });

  describe('recordLockContention', () => {
    it('emits lockAcquired and EvolutionLockContention metrics', async () => {
      EVOLUTION_METRICS.recordLockContention('lock-1', 'agent-1');

      expect(emitMetrics).toHaveBeenCalledWith([
        {
          MetricName: 'LockAcquired',
          Value: 0,
          Unit: 'Count',
          Dimensions: [{ Name: 'LockId', Value: 'lock-1' }],
        },
        {
          MetricName: 'EvolutionLockContention',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'LockId', Value: 'lock-1' },
            { Name: 'AgentId', Value: 'agent-1' },
          ],
        },
      ]);
    });

    it('logs warning if emitMetrics fails', async () => {
      const error = new Error('Failed');
      (emitMetrics as any).mockRejectedValueOnce(error);

      EVOLUTION_METRICS.recordLockContention('lock-1', 'agent-1');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to emit EvolutionLockContention metric:',
        error
      );
    });
  });
});
