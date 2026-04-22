'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Zap } from 'lucide-react';
import { THEME } from '@/lib/theme';
import PageHeader from '@/components/PageHeader';

// Dynamic import for React Flow component to avoid SSR issues
const Flow = dynamic(() => import('./Flow'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <div
        className={`text-${THEME.COLORS.INTEL} animate-pulse font-mono uppercase text-sm tracking-widest`}
      >
        Establishing Neural Uplink...
      </div>
    </div>
  ),
});

export default function SystemPulsePage() {
  return (
    <main
      className={`flex-1 h-screen overflow-hidden flex flex-col p-6 lg:p-10 space-y-6 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-${THEME.COLORS.INTEL}/5 via-transparent to-transparent`}
    >
      <PageHeader titleKey="SYSPULSE_TITLE" subtitleKey="SYSPULSE_SUBTITLE" />

      <div className="flex-1 min-h-0 glass-card border-border overflow-hidden flex flex-col">
        <div className="px-6 py-3 border-b border-border bg-card flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground">
            <Zap size={14} className={`text-${THEME.COLORS.INTEL}`} /> Architecture Map
          </div>
          <div className="flex items-center gap-4 text-[9px] text-muted-more">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-cyber-green"></div> AGENT_NODE
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-orange-500"></div> PRIMARY_BUS
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-cyber-blue"></div> INFRA_NODE
            </div>
          </div>
        </div>
        <div className="flex-1 relative">
          <Flow />
        </div>
      </div>
    </main>
  );
}
