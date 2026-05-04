'use client';

import React from 'react';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import PageHeader from '@/components/PageHeader';

interface ResilienceHeaderProps {
  isHealthy: boolean;
  healthStatus: string;
  recoveryOpsCount: number;
}

export default function ResilienceHeader({
  isHealthy,
  healthStatus,
  recoveryOpsCount,
}: ResilienceHeaderProps) {
  const { t } = useTranslations();

  return (
    <PageHeader
      titleKey="RESILIENCE_TITLE"
      subtitleKey="RESILIENCE_SUBTITLE"
      stats={
        <div className="flex gap-4">
          <Card
            variant="glass"
            padding="sm"
            className={`px-4 py-2 min-w-[120px] border-2 ${isHealthy ? 'border-[var(--cyber-green)]/30' : 'border-red-500/50 animate-pulse'}`}
          >
            <Typography variant="mono" color="white" className="mb-1 block opacity-90">
              {t('RESILIENCE_SYSTEM_STATUS')}
            </Typography>
            <div
              className={`font-bold flex items-center gap-2 ${isHealthy ? 'text-[var(--cyber-green)]' : 'text-red-500'}`}
            >
              {isHealthy ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
              {healthStatus}
            </div>
          </Card>
          <Card variant="glass" padding="sm" className="px-4 py-2 min-w-[120px]">
            <Typography variant="mono" color="white" className="mb-1 block opacity-90">
              {t('RESILIENCE_RECOVERY_OPS')}
            </Typography>
            <Typography variant="h3" weight="bold" className="text-yellow-500">
              {recoveryOpsCount}
            </Typography>
          </Card>
        </div>
      }
    />
  );
}
