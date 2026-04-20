import { useState, useEffect, useCallback } from 'react';

/**
 * ResilienceStatus
 * Aggregated state for the system resilience HUD.
 */
export interface ResilienceStatus {
  healthScore: number;
  errorRate: number;
  recoverySuccess: number;
  recoveryCount: number;
  circuitBreaker: {
    state: 'closed' | 'open' | 'half_open';
    lastFailure?: number;
    failureCount: number;
    emergencyDeployCount: number;
  };
  burnRate: {
    totalTokens: number;
    dailyBudget: number;
    burnRatePerHour: number;
    usageRatio: number;
  };
  lastUpdated: number;
}

/**
 * useResilienceStatus
 * React hook that polls resilience metrics and token burn-rates.
 * @param intervalMs - Polling interval in milliseconds (default: 30s)
 */
export function useResilienceStatus(intervalMs = 30000) {
  const [data, setData] = useState<ResilienceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [resilienceRes, burnRateRes] = await Promise.all([
        fetch('/api/resilience/metrics', { cache: 'no-store' }),
        fetch('/api/system/burn-rate', { cache: 'no-store' }),
      ]);

      if (!resilienceRes.ok || !burnRateRes.ok) {
        throw new Error('Failed to fetch resilience status');
      }

      const resilience = await resilienceRes.json();
      const burnRate = await burnRateRes.json();

      setData({
        ...resilience,
        burnRate,
        lastUpdated: Date.now(),
      });
      setError(null);
    } catch (err) {
      console.error('Resilience poll failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, intervalMs);
    return () => clearInterval(interval);
  }, [fetchStatus, intervalMs]);

  return { data, loading, error, refetch: fetchStatus };
}
