'use client';

import React from 'react';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import PageHeader from '@/components/PageHeader';

interface CapabilitiesHeaderProps {
  localCount: number;
  bridgeCount: number;
}

export default function CapabilitiesHeader({ localCount, bridgeCount }: CapabilitiesHeaderProps) {
  const { t } = useTranslations();

  return (
    <PageHeader
      titleKey="CAPABILITIES_TITLE"
      subtitleKey="CAPABILITIES_SUBTITLE"
      stats={
        <div className="flex gap-4">
          <div className="flex flex-col items-center text-center">
            <Typography
              variant="mono"
              color="muted"
              className="text-[10px] uppercase tracking-widest opacity-60 mb-1 font-black"
            >
              {t('CAPABILITIES_LOCAL')}
            </Typography>
            <Badge
              variant="outline"
              className="px-4 py-1 font-black text-xs border-amber-500/30 text-amber-600 dark:text-yellow-500/60 uppercase bg-amber-500/5"
            >
              {localCount}
            </Badge>
          </div>
          <div className="flex flex-col items-center text-center">
            <Typography
              variant="mono"
              color="muted"
              className="text-[10px] uppercase tracking-widest opacity-60 mb-1 font-black"
            >
              {t('CAPABILITIES_BRIDGES')}
            </Typography>
            <Badge
              variant="outline"
              className="px-4 py-1 font-black text-xs border-cyber-blue/30 text-cyber-blue/60 uppercase bg-cyber-blue/5"
            >
              {bridgeCount}
            </Badge>
          </div>
        </div>
      }
    />
  );
}
