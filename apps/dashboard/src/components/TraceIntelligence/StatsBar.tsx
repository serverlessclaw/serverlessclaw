'use client';

import React from 'react';
import { Activity, LayoutGrid, Wrench, Zap } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import { Trace } from '@/lib/types/ui';

interface StatsBarProps {
  traces: Trace[];
  t: (key: any) => string;
}

export default function StatsBar({ traces, t }: StatsBarProps) {
  const stats = [
    {
      label: t('TOTAL_OPERATIONS'),
      value: traces.length,
      icon: Activity,
      color: 'text-cyber-blue',
    },
    {
      label: t('ACTIVE_SESSIONS'),
      value: new Set(traces.map((t) => t.sessionId || (t as any).initialContext?.sessionId)).size,
      icon: LayoutGrid,
      color: 'text-purple-400',
    },
    {
      label: t('TOOLS_INVOKED'),
      value: new Set(traces.flatMap((t) => (t as any).toolsUsed || [])).size,
      icon: Wrench,
      color: 'text-yellow-400',
    },
    {
      label: t('TOKEN_COST'),
      value: `${((traces.reduce((acc, t) => acc + ((t as any).totalTokens || 0), 0)) / 1000).toFixed(1)}k`,
      icon: Zap,
      color: 'text-cyber-green',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <div
          key={i}
          className="glass-card p-4 flex flex-col items-center justify-center border-border"
        >
          <stat.icon size={20} className={`${stat.color} mb-2 opacity-80`} />
          <Typography variant="mono" className="text-xl font-black">
            {stat.value}
          </Typography>
          <Typography
            variant="mono"
            color="muted"
            className="text-[9px] uppercase tracking-widest opacity-40 mt-1"
          >
            {stat.label}
          </Typography>
        </div>
      ))}
    </div>
  );
}
