/**
 * @module ResilienceMetricsAPI
 * Returns aggregated resilience metrics for the dashboard gauge HUD.
 */
import { withApiHandler } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = withApiHandler(async () => {
  const { DynamoMemory } = await import('@claw/core/lib/memory');
  const memory = new DynamoMemory();

  // Fetch recovery logs
  const recoveryLogs = await memory.listByPrefix('DISTILLED#RECOVERY');
  const recoveryCount = recoveryLogs.length;
  const recentFailures = recoveryLogs.filter(
    (log) => Date.now() - log.timestamp < 24 * 60 * 60 * 1000
  ).length;

  // Health score: start at 100, deduct for recent failures
  const healthScore = Math.max(0, 100 - recentFailures * 20);

  // Error rate: failures in last 24h / total logs (capped)
  const errorRate = recoveryCount > 0 ? Math.min(100, (recentFailures / Math.max(1, recoveryCount)) * 100) : 0;

  // Recovery success: inversely proportional to error rate
  const recoverySuccess = Math.max(0, 100 - errorRate);

  return {
    healthScore,
    errorRate: Math.round(errorRate),
    recoverySuccess: Math.round(recoverySuccess),
    recoveryCount,
    recentFailures,
    lastUpdated: Date.now(),
  };
});
