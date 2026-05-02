'use client';

import React from 'react';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/PageHeader';

interface CapabilitiesHeaderProps {
  localCount: number;
  bridgeCount: number;
}

export default function CapabilitiesHeader({ localCount, bridgeCount }: CapabilitiesHeaderProps) {
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
              className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
            >
              LOCAL
            </Typography>
            <Badge variant="primary" className="px-4 py-1 font-black text-xs">
              {localCount}
            </Badge>
          </div>
          <div className="flex flex-col items-center text-center">
            <Typography
              variant="mono"
              color="muted"
              className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
            >
              BRIDGES
            </Typography>
            <Badge variant="intel" className="px-4 py-1 font-black text-xs">
              {bridgeCount}
            </Badge>
          </div>
        </div>
      }
    />
  );
}
