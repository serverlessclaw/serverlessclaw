'use client';

import React from 'react';
import { Activity, Timer, Zap } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

interface HealthData {
  deployCountToday?: number | string;
  message?: string;
  details?: string;
  url?: string;
}

interface ResilienceDiagnosticsCardProps {
  isHealthy: boolean;
  healthData: HealthData;
}

export default function ResilienceDiagnosticsCard({
  isHealthy,
  healthData,
}: ResilienceDiagnosticsCardProps) {
  const { t } = useTranslations();

  return (
    <div className="lg:col-span-1 space-y-8">
      <Card variant="glass" padding="lg" className="border-white/10 bg-black/40">
        <Typography
          variant="caption"
          weight="bold"
          className="tracking-[0.2em] flex items-center gap-2 mb-6"
        >
          <Activity size={14} className="text-[var(--cyber-green)]" />{' '}
          {t('RESILIENCE_REALTIME_DIAGNOSTICS')}
        </Typography>

        <div className="space-y-6">
          <div className="flex justify-between items-center text-sm">
            <span className="text-white/100">{t('RESILIENCE_CORE_API')}</span>
            <span className="text-cyber-green font-bold">{t('RESILIENCE_STABLE')}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-white/100">{t('RESILIENCE_DYNAMODB_LAYER')}</span>
            <span className="text-cyber-green font-bold text-xs">
              {healthData.deployCountToday !== undefined
                ? `${t('RESILIENCE_OPERATIONAL')} (${healthData.deployCountToday} deploys today)`
                : t('RESILIENCE_OPERATIONAL')}
            </span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-white/100">{t('RESILIENCE_LAST_PROBE')}</span>
            <span className="text-white/90 text-[10px]">{new Date().toLocaleTimeString()}</span>
          </div>
        </div>

        {!isHealthy && (
          <div className="mt-8 p-4 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs leading-relaxed italic space-y-2">
            <div className="font-bold">
              {t('RESILIENCE_CAUTION')}{' '}
              {healthData.message || t('RESILIENCE_HEALTH_FAILURE_WARNING')}
            </div>
            {healthData.details && (
              <div className="opacity-80">
                <span className="font-mono uppercase text-[10px] mr-2">Error:</span>
                {healthData.details}
              </div>
            )}
            {healthData.url && (
              <div className="opacity-80 break-all">
                <span className="font-mono uppercase text-[10px] mr-2">Target:</span>
                {healthData.url}/health
              </div>
            )}
            <div className="pt-2 text-[10px] opacity-60 not-italic">
              {t('RESILIENCE_LOCAL_DEV_ADVISORY')}
            </div>
          </div>
        )}
      </Card>

      <Card
        variant="glass"
        padding="lg"
        className="border-white/10 bg-black/40 relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 rounded-full blur-3xl -mr-16 -mt-16"></div>
        <Typography
          variant="caption"
          weight="bold"
          className="tracking-[0.2em] flex items-center gap-2 mb-6"
        >
          <Timer size={14} className="text-yellow-500" /> {t('RESILIENCE_DMS_TITLE')}
        </Typography>

        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-full border border-yellow-500/20 flex items-center justify-center bg-yellow-500/5">
            <Zap size={20} className="text-yellow-500" />
          </div>
          <div>
            <div className="text-xs font-bold text-white/90">
              {t('RESILIENCE_AUTONOMOUS_PULSE')}
            </div>
            <div className="text-[10px] text-white/100">{t('RESILIENCE_SCHEDULES_FREQ')}</div>
          </div>
        </div>

        <div className="p-3 bg-white/[0.02] border border-white/5 rounded space-y-2">
          <div className="flex justify-between text-[10px]">
            <span className="text-white/100 uppercase">Mode</span>
            <span className="text-yellow-500/80 font-bold">AUTO_RECOVERY</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-white/100 uppercase">Action</span>
            <span className="text-white/70 italic">TRIGGER_ROLLBACK</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
