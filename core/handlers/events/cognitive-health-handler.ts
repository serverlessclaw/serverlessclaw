import { logger } from '../../lib/logger';
import { EventType } from '../../lib/types/agent';
import type { BaseMemoryProvider } from '../../lib/memory/base';
import { CognitiveHealthMonitor } from '../../lib/metrics/cognitive-metrics';
import { DynamoMemory } from '../../lib/memory';
import { emitEvent, EventPriority } from '../../lib/utils/bus';

/**
 * Handles cognitive health check events.
 * Takes a cognitive health snapshot and alerts if the score is below threshold.
 *
 * @param eventDetail - The event detail payload containing optional agentIds to check.
 */
export async function handleCognitiveHealthCheck(
  eventDetail: Record<string, unknown>
): Promise<void> {
  const memory = new DynamoMemory();
  const monitor = new CognitiveHealthMonitor(memory as unknown as BaseMemoryProvider);
  monitor.start();

  try {
    const { listWorkspaceIds } = await import('../../lib/memory/workspace-operations');
    const workspaceIds = await listWorkspaceIds();

    // Check global agents
    const globalSnapshot = await monitor.takeSnapshot(eventDetail.agentIds as string[]);
    logger.info(
      `[HEALTH] Global cognitive health snapshot: score=${globalSnapshot.overallScore}, anomalies=${globalSnapshot.anomalies.length}`
    );
    if (globalSnapshot.overallScore < 70) {
      await alertDegradedHealth(globalSnapshot, 'Global');
    }

    // Check each workspace
    for (const workspaceId of workspaceIds) {
      const workspaceSnapshot = await monitor.takeSnapshot(
        eventDetail.agentIds as string[],
        workspaceId
      );
      if (workspaceSnapshot.overallScore < 70) {
        logger.warn(
          `[HEALTH] Workspace ${workspaceId} cognitive health degraded: score=${workspaceSnapshot.overallScore}`
        );
        await alertDegradedHealth(workspaceSnapshot, `Workspace:${workspaceId}`, workspaceId);
      }
    }
  } catch (error) {
    logger.error('Failed to perform multi-tenant cognitive health check:', error);
  } finally {
    monitor.stop();
  }
}

/**
 * Alerts when health is degraded.
 */
async function alertDegradedHealth(
  snapshot: {
    overallScore: number;
    anomalies: { severity: string }[];
    agentMetrics: { agentId: string; taskCompletionRate: number; errorRate: number }[];
  },
  label: string,
  workspaceId?: string
): Promise<void> {
  const criticalAnomalies = snapshot.anomalies.filter(
    (a: { severity: string }) => a.severity === 'critical' || a.severity === 'high'
  );

  try {
    const severity = snapshot.overallScore < 50 ? 'critical' : 'high';
    const priority = severity === 'critical' ? EventPriority.CRITICAL : EventPriority.HIGH;
    await emitEvent(
      'cognitive-health',
      EventType.SYSTEM_HEALTH_REPORT,
      {
        component: 'CognitiveHealthMonitor',
        issue: `[${label}] Cognitive health score dropped to ${snapshot.overallScore}/100. ${criticalAnomalies.length} critical anomalies detected.`,
        severity,
        workspaceId,
        context: {
          overallScore: snapshot.overallScore,
          anomalyCount: snapshot.anomalies.length,
          criticalCount: criticalAnomalies.length,
          agentMetrics: snapshot.agentMetrics.map(
            (m: { agentId: string; taskCompletionRate: number; errorRate: number }) => ({
              agentId: m.agentId,
              completionRate: m.taskCompletionRate,
              errorRate: m.errorRate,
            })
          ),
        },
      },
      { priority }
    );
  } catch (error) {
    logger.error(`Failed to emit cognitive health alert for ${label}:`, error);
  }
}
