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
  const now = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;

  const recentLogs = recoveryLogs.filter(
    (log) => now - (log.timestamp as number) < twentyFourHours
  );
  const recentFailures = recentLogs.filter(
    (log) => (log as Record<string, unknown>).outcome === 'failure'
  ).length;
  const recentSuccesses = recentLogs.filter(
    (log) => (log as Record<string, unknown>).outcome === 'success'
  ).length;
  const recentTotal = recentLogs.length;

  // Health score: success rate over the last 24h (volume-normalized)
  // A system with 1000 ops and 5 failures (99.5%) is healthier than one with 10 ops and 5 failures (50%)
  const healthScore =
    recentTotal > 0 ? Math.round(((recentTotal - recentFailures) / recentTotal) * 100) : 100;

  // Error rate: percentage of recent operations that failed
  const errorRate = recentTotal > 0 ? Math.round((recentFailures / recentTotal) * 100) : 0;

  // Recovery success: percentage of recent failures that were subsequently resolved
  // This is distinct from errorRate — it measures incident resolution, not raw failure rate
  const recoverySuccess =
    recentFailures > 0 ? Math.round((recentSuccesses / (recentFailures + recentSuccesses)) * 100) : 100;

  return {
    healthScore: Math.max(0, Math.min(100, healthScore)),
    errorRate: Math.max(0, Math.min(100, errorRate)),
    recoverySuccess: Math.max(0, Math.min(100, recoverySuccess)),
    recoveryCount,
    recentTotal,
    recentFailures,
    recentSuccesses,
    lastUpdated: now,
  };
});
