import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EVOLUTION_METRICS } from './evolution-metrics';
import { emitMetrics } from './metrics';

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
    debug: vi.fn(),
  },
}));

describe('EVOLUTION_METRICS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordDuplicateSuppression', () => {
    it('emits EvolutionDuplicateSuppression metric', async () => {
      EVOLUTION_METRICS.recordDuplicateSuppression('test-source', {
        workspaceId: 'ws-123',
        orgId: 'org-456',
      });

      expect(emitMetrics).toHaveBeenCalledWith([
        {
          MetricName: 'EvolutionDuplicateSuppression',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'Source', Value: 'test-source' },
            { Name: 'WorkspaceId', Value: 'ws-123' },
            { Name: 'OrgId', Value: 'org-456' },
          ],
        },
      ]);
    });
  });

  describe('recordTransitionRejection', () => {
    it('emits EvolutionTransitionRejection metric with scope', async () => {
      EVOLUTION_METRICS.recordTransitionRejection('gap-1', 'OPEN', 'CLOSED', 'invalid-guard', {
        workspaceId: 'ws-123',
      });

      expect(emitMetrics).toHaveBeenCalledWith([
        {
          MetricName: 'EvolutionTransitionRejection',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'FromStatus', Value: 'OPEN' },
            { Name: 'ToStatus', Value: 'CLOSED' },
            { Name: 'Reason', Value: 'invalid-guard' },
            { Name: 'WorkspaceId', Value: 'ws-123' },
          ],
        },
      ]);
    });
  });

  describe('recordBarrierTimeout', () => {
    it('emits EvolutionBarrierTimeout metric with scope', async () => {
      EVOLUTION_METRICS.recordBarrierTimeout('trace-1', 10, 5, { orgId: 'org-456' });

      expect(emitMetrics).toHaveBeenCalledWith([
        {
          MetricName: 'EvolutionBarrierTimeout',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'TaskCount', Value: '10' },
            { Name: 'CompletionRate', Value: '0.50' },
            { Name: 'OrgId', Value: 'org-456' },
          ],
        },
      ]);
    });
  });

  describe('recordGapReopen', () => {
    it('emits EvolutionGapReopen metric with scope', async () => {
      EVOLUTION_METRICS.recordGapReopen('gap-1', 3, { workspaceId: 'ws-123' });

      expect(emitMetrics).toHaveBeenCalledWith([
        {
          MetricName: 'EvolutionGapReopen',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'AttemptCount', Value: '3' },
            { Name: 'WorkspaceId', Value: 'ws-123' },
          ],
        },
      ]);
    });
  });

  describe('recordLockContention', () => {
    it('emits metrics with scope', async () => {
      const scope = { workspaceId: 'ws-123', orgId: 'org-456' };
      EVOLUTION_METRICS.recordLockContention('lock-1', 'agent-1', scope);

      expect(emitMetrics).toHaveBeenCalledWith([
        expect.objectContaining({
          MetricName: 'LockAcquired',
          Value: 0,
        }),
        expect.objectContaining({
          MetricName: 'EvolutionLockContention',
          Dimensions: expect.arrayContaining([
            { Name: 'WorkspaceId', Value: 'ws-123' },
            { Name: 'OrgId', Value: 'org-456' },
          ]),
        }),
      ]);
    });
  });

  describe('recordToolExecution', () => {
    it('emits ToolExecution metrics with workspaceId', async () => {
      EVOLUTION_METRICS.recordToolExecution('test_tool', true, 500, {
        workspaceId: 'ws-123',
        orgId: 'org-456',
      });

      expect(emitMetrics).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            MetricName: 'ToolExecutionCount',
            Dimensions: expect.arrayContaining([{ Name: 'WorkspaceId', Value: 'ws-123' }]),
          }),
        ])
      );
    });
  });

  describe('recordToolROI', () => {
    it('emits ToolROI metrics with workspaceId', async () => {
      EVOLUTION_METRICS.recordToolROI('test_tool', 1.0, 100, {
        workspaceId: 'ws-123',
        orgId: 'org-456',
      });

      expect(emitMetrics).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            MetricName: 'ToolROIValue',
            Dimensions: expect.arrayContaining([{ Name: 'WorkspaceId', Value: 'ws-123' }]),
          }),
        ])
      );
    });
  });
});
