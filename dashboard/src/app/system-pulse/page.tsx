'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Share2, Zap, Info } from 'lucide-react';
import { THEME } from '@/lib/theme';

// Dynamic import for React Flow component to avoid SSR issues
const Flow = dynamic(() => import('./Flow'), { 
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <div className={`text-${THEME.COLORS.INTEL} animate-pulse font-mono uppercase text-sm tracking-widest`}>
        Establishing Neural Uplink...
      </div>
    </div>
  )
});

export default function SystemPulsePage() {
  return (
    <main className={`flex-1 h-screen overflow-hidden flex flex-col p-10 space-y-6 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-${THEME.COLORS.INTEL}/5 via-transparent to-transparent`}>
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <h2 className={`text-3xl font-bold tracking-tight text-white/90 uppercase`}>SYSTEM_PULSE</h2>
          <p className="text-white/100 text-sm mt-2 font-light">Real-time infrastructure topology and neural routing visualization.</p>
        </div>
        <div className="flex gap-4">
          <div className="glass-card px-4 py-2 text-[12px] border-white/10">
            <div className="text-white/90 mb-1 font-bold uppercase tracking-widest opacity-50">SYNC_STATUS</div>
            <div className={`font-bold text-${THEME.COLORS.PRIMARY}`}>STABLE</div>
          </div>
          <div className="glass-card px-4 py-2 text-[12px] border-white/10 text-white/90">
            <div className="mb-1 font-bold uppercase tracking-widest opacity-50">NODES_ACTIVE</div>
            <div className="font-bold font-mono">14</div>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 glass-card border-white/5 overflow-hidden flex flex-col">
        <div className="px-6 py-3 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-[0.2em] text-white/70">
            <Zap size={14} className={`text-${THEME.COLORS.INTEL}`} /> Architecture Map
          </div>
          <div className="flex items-center gap-4 text-[9px] text-white/40">
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

      <footer className="grid grid-cols-3 gap-6">
        <div className="glass-card p-4 flex gap-4 items-start">
          <div className="p-2 rounded bg-white/5">
            <Info size={16} className="text-white/50" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-white/90 tracking-widest">Topology_Scan</div>
            <p className="text-[10px] text-white/50 mt-1 leading-relaxed italic">
              Mapping autonomous agent dependencies and IAM-hardware boundaries.
            </p>
          </div>
        </div>
        <div className="col-span-2 glass-card p-4 flex items-center justify-between">
            <div className="flex gap-8">
                <div>
                    <div className="text-[8px] uppercase text-white/40 font-bold tracking-[0.3em]">Latency_ms</div>
                    <div className="text-sm font-mono font-bold text-white/90">42ms</div>
                </div>
                <div>
                    <div className="text-[8px] uppercase text-white/40 font-bold tracking-[0.3em]">Traffic_Load</div>
                    <div className="text-sm font-mono font-bold text-white/90">NOMINAL</div>
                </div>
                <div>
                    <div className="text-[8px] uppercase text-white/40 font-bold tracking-[0.3em]">Trace_Density</div>
                    <div className="text-sm font-mono font-bold text-white/90">HIGH</div>
                </div>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-white/100 uppercase tracking-widest">
                <Share2 size={12} className={`text-${THEME.COLORS.INTEL}`} /> Stream_Online
            </div>
        </div>
      </footer>
    </main>
  );
}
