'use client';

import React from 'react';
import { Activity, ShieldCheck, Cpu, MessageSquare, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-white/10 flex flex-col p-6 space-y-8 bg-black/20 shrink-0">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 bg-cyber-green rounded-sm flex items-center justify-center text-black font-bold group-hover:scale-105 transition-transform">
            C
          </div>
          <h1 className="text-xl font-bold tracking-tighter">CLAW_MONITOR</h1>
        </Link>
      </div>

      <nav className="flex-1 space-y-4 text-sm">
        <div className="text-white/40 px-2 uppercase text-[10px] tracking-widest font-bold">System</div>
        <Link 
          href="/" 
          className={`flex items-center gap-3 px-2 py-2 rounded transition-colors ${
            pathname === '/' || pathname.startsWith('/trace') 
              ? 'bg-white/5 text-cyber-green' 
              : 'text-white/60 hover:bg-white/5'
          }`}
        >
          <Activity size={16} /> TRACE_INTEL
        </Link>
        <Link 
          href="/chat" 
          className={`flex items-center gap-3 px-2 py-2 rounded transition-colors ${
            pathname === '/chat' 
              ? 'bg-white/5 text-cyber-green' 
              : 'text-white/60 hover:bg-white/5'
          }`}
        >
          <MessageSquare size={16} /> CHAT_DIRECT
        </Link>
        <Link 
          href="/settings" 
          className={`flex items-center gap-3 px-2 py-2 rounded transition-colors ${
            pathname === '/settings' 
              ? 'bg-white/5 text-cyber-green' 
              : 'text-white/60 hover:bg-white/5'
          }`}
        >
          <Settings size={16} /> SYSTEM_CONFIG
        </Link>
        <div className="text-white/40 px-2 pt-4 uppercase text-[10px] tracking-widest font-bold">Observability</div>
        <Link 
          href="/resilience" 
          className={`flex items-center gap-3 px-2 py-2 rounded transition-colors ${
            pathname === '/resilience' 
              ? 'bg-white/5 text-cyber-green' 
              : 'text-white/60 hover:bg-white/5'
          }`}
        >
          <ShieldCheck size={16} /> SELF_HEALING
        </Link>
        <Link 
          href="/memory" 
          className={`flex items-center gap-3 px-2 py-2 rounded transition-colors ${
            pathname === '/memory' 
              ? 'bg-white/5 text-cyber-green' 
              : 'text-white/60 hover:bg-white/5'
          }`}
        >
          <Cpu size={16} /> MEMORY_VAULT
        </Link>
      </nav>

      <div className="pt-6 border-t border-white/5">
        <div className="text-[10px] text-white/30">VERSION: 1.0.0-PROTOTYPE</div>
        <div className="text-[10px] text-cyber-green mt-1 flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyber-green opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyber-green"></span>
          </span>
          SYSTEM_ONLINE
        </div>
      </div>
    </aside>
  );
}
