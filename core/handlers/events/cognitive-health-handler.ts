import { logger } from '../../lib/logger';
import { EventType } from '../../lib/types/agent';
import type { BaseMemoryProvider } from '../../lib/memory/base';

/**
 * Handles cognitive health check events.
 * Takes a cognitive health snapshot and alerts if the score is below threshold.
 */
export async function handleCognitiveHealthCheck(
  eventDetail: Record<string, unknown>
): Promise<void> {
  const { CognitiveHealthMonitor } = await import('../../lib/cognitive-metrics');
  const { DynamoMemory } = await import('../../lib/memory');
  const { emitEvent } = await import('../../lib/utils/bus');

  const memory = new DynamoMemory();
  const monitor = new CognitiveHealthMonitor(memory as unknown as BaseMemoryProvider);

  const agentIds = (eventDetail.agentIds as string[]) ?? undefined;
  const snapshot = await monitor.takeSnapshot(agentIds);

  logger.info(
    `Cognitive health snapshot: score=${snapshot.overallScore}, anomalies=${snapshot.anomalies.length}`
  );

  // Alert if health is degraded
  if (snapshot.overallScore < 70) {
    const criticalAnomalies = snapshot.anomalies.filter(
      (a) => a.severity === 'critical' || a.severity === 'high'
    );

    logger.warn(
      `Cognitive health degraded: score=${snapshot.overallScore}, critical anomalies=${criticalAnomalies.length}`
    );

    // Emit a health report for the alerting system to pick up
    try {
      await emitEvent('cognitive-health', EventType.SYSTEM_HEALTH_REPORT, {
        component: 'CognitiveHealthMonitor',
        issue: `Cognitive health score dropped to ${snapshot.overallScore}/100. ${criticalAnomalies.length} critical anomalies detected.`,
        severity: snapshot.overallScore < 50 ? 'critical' : 'high',
        context: {
          overallScore: snapshot.overallScore,
          anomalyCount: snapshot.anomalies.length,
          criticalCount: criticalAnomalies.length,
          agentMetrics: snapshot.agentMetrics.map((m) => ({
            agentId: m.agentId,
            completionRate: m.taskCompletionRate,
            errorRate: m.errorRate,
          })),
        },
      });
    } catch (error) {
      logger.error('Failed to emit cognitive health alert:', error);
    }
  }
}
