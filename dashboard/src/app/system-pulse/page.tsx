'use client';

import React from 'react';
import { Zap, Share2 } from 'lucide-react';
import dynamic from 'next/dynamic';

const SystemPulseFlow = dynamic(() => import('./Flow'), { 
  ssr: false,
  loading: () => (
    <div className="h-[600px] w-full bg-black/40 border border-white/5 rounded-lg flex flex-col items-center justify-center text-white/20 animate-pulse">
        <Share2 size={48} className="mb-4 opacity-10" />
        <p className="text-sm font-mono uppercase tracking-widest">Initialising Neural Map...</p>
    </div>
  )
});

export default function SystemPulsePage() {
  return (
    <main className="flex-1 overflow-y-auto p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-orange-500/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight glow-text-orange text-orange-500">SYSTEM_PULSE</h2>
          <p className="text-white/40 text-sm mt-2 font-light">Interactive topography of multi-agent orchestration and event bus flow.</p>
        </div>
        <div className="flex gap-4">
          <div className="glass-card px-4 py-2 text-[12px] border-orange-500/30">
            <div className="text-white/30 mb-1">NODE_COUNT</div>
            <div className="font-bold text-orange-500">6</div>
          </div>
          <div className="glass-card px-4 py-2 text-[12px]">
            <div className="text-white/30 mb-1">BUS_STATUS</div>
            <div className="font-bold text-cyber-green">HEALTHY</div>
          </div>
        </div>
      </header>

      <section className="space-y-4">
        <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/40 flex items-center gap-2">
          <Zap size={14} className="text-orange-500" /> Neural Architecture Map
        </h3>
        
        <SystemPulseFlow />
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 space-y-3">
            <div className="text-[10px] font-bold text-cyber-green uppercase">Logic_Core</div>
            <p className="text-xs text-white/60 leading-relaxed">
                The Main Manager Lambda. Processes input, retrieves long-term memory, and decides when to delegate tasks to spokes.
            </p>
        </div>
        <div className="glass-card p-6 space-y-3 border-orange-500/10">
            <div className="text-[10px] font-bold text-orange-500 uppercase">AgentBus</div>
            <p className="text-xs text-white/60 leading-relaxed">
                AWS EventBridge. The asynchronous backbone that allows decoupled agents to communicate without direct dependencies.
            </p>
        </div>
        <div className="glass-card p-6 space-y-3 border-cyber-blue/10">
            <div className="text-[10px] font-bold text-cyber-blue uppercase">Worker_Spokes</div>
            <p className="text-xs text-white/60 leading-relaxed">
                Specialised agents (Coder, Monitor) that perform heavy lifting like writing code or observing build logs.
            </p>
        </div>
      </div>
    </main>
  );
}
