import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emitMetrics } from './metrics';

/**
 * Integration test for CloudWatch metrics.
 *
 * This test verifies that the running identity has permissions to call
 * cloudwatch:PutMetricData. It is intended to be run in an environment
 * with real AWS credentials (e.g., local dev or CI with AWS access).
 *
 * To run: INTEGRATION_TESTS=true pnpm vitest core/lib/metrics.integration.test.ts
 */
describe('Metrics Permission Integration', () => {
  const isIntegrationTest = process.env.INTEGRATION_TESTS === 'true';

  beforeEach(() => {
    if (!isIntegrationTest) {
      console.log('Skipping integration test (INTEGRATION_TESTS not set to true)');
    }
  });

  it('should successfully emit a heartbeat metric to CloudWatch', async () => {
    if (!isIntegrationTest) return;

    // We emit a small, harmless "IntegrationTestHeartbeat" metric
    // to verify connectivity and permissions.
    const metric = {
      MetricName: 'IntegrationTestHeartbeat',
      Value: 1,
      Unit: 'Count' as const,
      Dimensions: [
        { Name: 'Environment', Value: process.env.SST_STAGE || 'local' },
        { Name: 'TestRunner', Value: 'Vitest' },
      ],
    };

    // This will throw or log an error if AccessDenied occurs.
    // In our implementation, emitMetrics catches errors and logs them.
    // We wrap it to ensure we can detect failure.

    const consoleSpy = vi.spyOn(console, 'error');

    await emitMetrics([metric]);

    // If AccessDenied happened, our implementation would have called console.error
    expect(consoleSpy).not.toHaveBeenCalled();

    console.log('[METRICS] Integration test emitted successfully.');
  });
});
