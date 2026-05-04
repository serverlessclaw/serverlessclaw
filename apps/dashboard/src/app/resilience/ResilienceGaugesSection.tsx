'use client';

import React from 'react';
import ResilienceGauge from './ResilienceGauge';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { useResilienceStatus } from '@/hooks/useResilienceStatus';

/**
 * ResilienceGaugesSection
 * Displays real-time system health, error density, circuit breaker status, and token burn-rate.
 * Uses useResilienceStatus for live polling.
 */
export default function ResilienceGaugesSection() {
  const { t } = useTranslations();
  const { data, loading, error } = useResilienceStatus(15000); // 15s polling for HUD

  if (loading && !data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 max-w-5xl mx-auto opacity-50">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col items-center animate-pulse">
            <div className="w-[140px] h-[140px] rounded-full bg-white/5 mb-4" />
            <div className="w-20 h-3 bg-white/10 rounded mb-2" />
            <div className="w-12 h-2 bg-white/5 rounded" />
          </div>
        ))}
      </div>
    );
  }

  // Fallback or static data if poll fails
  const status = data || {
    healthScore: 100,
    errorRate: 0,
    recoverySuccess: 100,
    circuitBreaker: { state: 'closed', failureCount: 0 },
    burnRate: { usageRatio: 0, burnRatePerHour: 0 },
  };

  // Map circuit breaker state to "value" for gauge
  const getCbValue = (state: string) => {
    if (state === 'closed') return 100;
    if (state === 'half_open') return 50;
    return 10;
  };

  const cbState = status.circuitBreaker?.state || 'closed';

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-center text-[10px] text-red-400/60 uppercase font-mono tracking-widest animate-pulse">
          {t('RESILIENCE_CONNECTION_ERROR')} - {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 max-w-5xl mx-auto">
        {/* 1. System Health */}
        <div className="flex justify-center">
          <ResilienceGauge
            value={status.healthScore}
            label={t('RESILIENCE_SYSTEM_HEALTH')}
            subtitle={t('RESILIENCE_GAUGE_API_DB')}
          />
        </div>

        {/* 2. Error Density */}
        <div className="flex justify-center">
          <ResilienceGauge
            value={Math.max(0, 100 - status.errorRate)}
            label={t('RESILIENCE_SYSTEM_STATUS')}
            subtitle={t('RESILIENCE_GAUGE_FAILURE_SIGNALS')}
          />
        </div>

        {/* 3. Circuit Breaker (Static -> Real) */}
        <div className="flex justify-center">
          <ResilienceGauge
            value={getCbValue(cbState)}
            label={t('RESILIENCE_DMS_TITLE')}
            subtitle={cbState.toUpperCase().replace('_', ' ')}
          />
        </div>

        {/* 4. Token Burn-Rate (New) */}
        <div className="flex justify-center">
          <ResilienceGauge
            value={Math.min(100, (status.burnRate?.usageRatio || 0) * 100)}
            label={t('RESILIENCE_BURN_RATE')}
            subtitle={`${status.burnRate?.burnRatePerHour || 0} TOKENS/HR`}
          />
        </div>
      </div>
    </div>
  );
}
