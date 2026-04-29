import { METRICS, emitMetrics } from './metrics';
import { logger } from '../logger';

/**
 * Evolution Metrics Utility
 *
 * Provides specialized metrics for monitoring the self-evolution loop,
 * including idempotency suppressions, state transition rejections,
 * parallel barrier timeouts, and retry bursts.
 */
export const EVOLUTION_METRICS = {
  /**
   * Records a duplicate continuation event that was suppressed by the idempotency layer.
   */
  recordDuplicateSuppression(
    source: string,
    scope?: { workspaceId?: string; orgId?: string }
  ): void {
    const dimensions = [{ Name: 'Source', Value: source }];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.orgId) dimensions.push({ Name: 'OrgId', Value: scope.orgId });

    emitMetrics([
      {
        MetricName: 'EvolutionDuplicateSuppression',
        Value: 1,
        Unit: 'Count',
        Dimensions: dimensions,
      },
    ]).catch((err) => logger.warn('Failed to emit EvolutionDuplicateSuppression metric:', err));
  },

  /**
   * Records a failed gap state transition (e.g., due to lock contention or invalid guard).
   */
  recordTransitionRejection(
    gapId: string,
    fromStatus: string,
    toStatus: string,
    reason: string,
    scope?: { workspaceId?: string; orgId?: string }
  ): void {
    const dimensions = [
      { Name: 'FromStatus', Value: fromStatus },
      { Name: 'ToStatus', Value: toStatus },
      { Name: 'Reason', Value: reason },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.orgId) dimensions.push({ Name: 'OrgId', Value: scope.orgId });

    emitMetrics([
      {
        MetricName: 'EvolutionTransitionRejection',
        Value: 1,
        Unit: 'Count',
        Dimensions: dimensions,
      },
    ]).catch((err) => logger.warn('Failed to emit EvolutionTransitionRejection metric:', err));
  },

  /**
   * Records a parallel barrier timeout event.
   */
  recordBarrierTimeout(
    traceId: string,
    taskCount: number,
    completedCount: number,
    scope?: { workspaceId?: string; orgId?: string }
  ): void {
    const dimensions = [
      { Name: 'TaskCount', Value: String(taskCount) },
      {
        Name: 'CompletionRate',
        Value: String(taskCount > 0 ? (completedCount / taskCount).toFixed(2) : 0),
      },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.orgId) dimensions.push({ Name: 'OrgId', Value: scope.orgId });

    emitMetrics([
      {
        MetricName: 'EvolutionBarrierTimeout',
        Value: 1,
        Unit: 'Count',
        Dimensions: dimensions,
      },
    ]).catch((err) => logger.warn('Failed to emit EvolutionBarrierTimeout metric:', err));
  },

  /**
   * Records a gap being reopened (retry) after a failure.
   */
  recordGapReopen(
    gapId: string,
    attemptCount: number,
    scope?: { workspaceId?: string; orgId?: string }
  ): void {
    const dimensions = [{ Name: 'AttemptCount', Value: String(attemptCount) }];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.orgId) dimensions.push({ Name: 'OrgId', Value: scope.orgId });

    emitMetrics([
      {
        MetricName: 'EvolutionGapReopen',
        Value: 1,
        Unit: 'Count',
        Dimensions: dimensions,
      },
    ]).catch((err) => logger.warn('Failed to emit EvolutionGapReopen metric:', err));
  },

  /**
   * Records a lock acquisition failure.
   */
  recordLockContention(
    lockId: string,
    agentId: string,
    scope?: { workspaceId?: string; orgId?: string }
  ): void {
    const dimensions = [
      { Name: 'LockId', Value: lockId },
      { Name: 'AgentId', Value: agentId },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.orgId) dimensions.push({ Name: 'OrgId', Value: scope.orgId });

    emitMetrics([
      METRICS.lockAcquired(lockId, false, scope),
      {
        MetricName: 'EvolutionLockContention',
        Value: 1,
        Unit: 'Count',
        Dimensions: dimensions,
      },
    ]).catch((err) => logger.warn('Failed to emit EvolutionLockContention metric:', err));
  },

  /**
   * Records tool execution metrics for ROI analysis.
   */
  recordToolExecution(
    toolName: string,
    success: boolean,
    durationMs: number,
    options?: { workspaceId?: string; orgId?: string }
  ): void {
    const dimensions = [
      { Name: 'ToolName', Value: toolName },
      { Name: 'Success', Value: String(success) },
      { Name: 'OrgId', Value: options?.orgId || 'GLOBAL' },
    ];
    if (options?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: options.workspaceId });

    emitMetrics([
      {
        MetricName: 'ToolExecutionCount',
        Value: 1,
        Unit: 'Count',
        Dimensions: dimensions,
      },
      {
        MetricName: 'ToolExecutionDuration',
        Value: durationMs,
        Unit: 'Milliseconds',
        Dimensions: dimensions.filter((d) => d.Name !== 'Success'),
      },
    ]).catch((err) => logger.warn('Failed to emit ToolExecution metrics:', err));
  },

  /**
   * Records estimated ROI value for a tool execution.
   */
  recordToolROI(
    toolName: string,
    estimatedValue: number,
    actualCost: number,
    options?: { workspaceId?: string; orgId?: string }
  ): void {
    const dimensions = [
      { Name: 'ToolName', Value: toolName },
      { Name: 'OrgId', Value: options?.orgId || 'GLOBAL' },
    ];
    if (options?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: options.workspaceId });

    emitMetrics([
      {
        MetricName: 'ToolROIValue',
        Value: estimatedValue,
        Unit: 'Count',
        Dimensions: dimensions,
      },
      {
        MetricName: 'ToolROICost',
        Value: actualCost,
        Unit: 'Count',
        Dimensions: dimensions,
      },
    ]).catch((err) => logger.warn('Failed to emit ToolROI metrics:', err));
  },
};
