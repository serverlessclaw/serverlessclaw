import { getResourceUrl } from '@/lib/sst-utils';

import { DynamoMemory } from '@claw/core/lib/memory';
import { logger } from '@claw/core/lib/logger';
import ResilienceHeader from './ResilienceHeader';
import ResilienceGaugesSection from './ResilienceGaugesSection';
import ResilienceDiagnosticsCard from './ResilienceDiagnosticsCard';
import ResilienceLogsCard from './ResilienceLogsCard';

async function getHealth() {
  const apiUrl = getResourceUrl('WebhookApi', 'url');

  if (!apiUrl) {
    logger.error('API URL is missing from Resources and Environment');
    return {
      status: 'error',
      message: 'Infrastructure Missing',
      details:
        'Neural Webhook API configuration is not active. Check SST links or environment variables (WEBHOOKAPI_URL).',
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(`${apiUrl}/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Health check failed. Status:', response.status, 'Body:', errorText);
      return {
        status: 'error',
        message: `Health check failed: ${response.status}`,
        details: errorText,
        url: apiUrl,
      };
    }
    return await response.json();
  } catch (e: unknown) {
    const error = e as Error;
    logger.error('Error fetching health status:', error);
    const isTimeout = error.name === 'AbortError';

    return {
      status: 'error',
      message: isTimeout ? 'System request timed out (5s).' : 'System unreachable or unresponsive.',
      details: error.message,
      url: apiUrl,
    };
  }
}

async function getRecoveryLogs() {
  try {
    const memory = new DynamoMemory();
    const items = await memory.listByPrefix('DISTILLED#RECOVERY');
    return (items ?? []).sort(
      (a: { timestamp?: number }, b: { timestamp?: number }) =>
        (b.timestamp ?? 0) - (a.timestamp ?? 0)
    );
  } catch (e) {
    logger.error('Error fetching recovery logs:', e);
    return [];
  }
}

async function getRecoveryState() {
  try {
    const memory = new DynamoMemory();
    const items = await memory.listByPrefix('SYSTEM#RECOVERY#STATS');
    return items?.[0] ?? null;
  } catch (e) {
    logger.error('Error fetching recovery state:', e);
    return null;
  }
}

/** ResilienceHub — displays the live health status, recovery logs, and Dead Man's Switch circuit-breaker state for the ClawCenter Observability sector. */
export default async function ResilienceHub() {
  const health = await getHealth();
  const logs = await getRecoveryLogs();
  const recoveryState = await getRecoveryState();

  const isHealthy = health.status === 'ok';
  const recoveryValue = recoveryState?.status === 'unhealthy' ? 30 : isHealthy ? 100 : 60;

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-yellow-500/5 via-transparent to-transparent">
      <ResilienceHeader
        isHealthy={isHealthy}
        healthStatus={health.status}
        recoveryOpsCount={logs.length}
      />

      <ResilienceGaugesSection />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <ResilienceDiagnosticsCard isHealthy={isHealthy} healthData={health} />
        <ResilienceLogsCard logs={logs} />
      </div>
    </main>
  );
}
