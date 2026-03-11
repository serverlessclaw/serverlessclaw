'use client';

import React from 'react';
import { Zap, Share2 } from 'lucide-react';
import dynamic from 'next/dynamic';

const SystemPulseFlow = dynamic(() => import('./Flow'), { 
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-black/40 border border-white/5 rounded-lg flex flex-col items-center justify-center text-white/20 animate-pulse">
        <Share2 size={48} className="mb-4 opacity-10" />
        <p className="text-sm font-mono uppercase tracking-widest">Initialising Neural Map...</p>
    </div>
  )
});

export default function SystemPulsePage() {
  return (
    <main className="flex-1 h-screen overflow-hidden flex flex-col p-10 space-y-6 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-orange-500/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6 shrink-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight glow-text-orange text-orange-500">SYSTEM_PULSE</h2>
          <p className="text-white/80 text-sm mt-2 font-light">Interactive topography of multi-agent orchestration and event bus flow.</p>
        </div>
        <div className="flex gap-4">
          <div className="glass-card px-4 py-2 text-[12px] border-orange-500/30">
            <div className="text-white/30 mb-1">NODE_COUNT</div>
            <div className="font-bold text-orange-500">DYNAMIC</div>
          </div>
          <div className="glass-card px-4 py-2 text-[12px]">
            <div className="text-white/30 mb-1">BUS_STATUS</div>
            <div className="font-bold text-cyber-green">HEALTHY</div>
          </div>
        </div>
      </header>

      <section className="flex-1 min-h-0 relative">
        <div className="absolute top-0 left-0 z-10">
          <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/80 flex items-center gap-2">
            <Zap size={14} className="text-orange-500" /> Neural Architecture Map
          </h3>
        </div>
        
        <div className="w-full h-full pt-6">
          <SystemPulseFlow />
        </div>
      </section>
    </main>
  );
}
