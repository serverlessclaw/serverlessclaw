'use client';

import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  ShieldCheck, 
  Cpu, 
  MessageSquare, 
  Settings, 
  Lock, 
  Share2, 
  Zap, 
  Menu, 
  X,
  ChevronRight,
  Users
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { THEME } from '@/lib/theme';

export default function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  // Close sidebar on navigation
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const navItems = [
    { label: 'Intelligence', type: 'header' },
    { href: '/chat', label: 'CHAT_DIRECT', icon: MessageSquare },
    { href: '/', label: 'TRACE_INTEL', icon: Activity, activePaths: ['/', '/trace'] },
    { href: '/agents', label: 'AGENTS', icon: Users },
    { label: 'System', type: 'header', className: 'pt-4' },
    { href: '/system-pulse', label: 'SYSTEM_PULSE', icon: Share2 },
    { href: '/locks', label: 'SESSION_TRAFFIC', icon: Lock },
    { href: '/settings', label: 'SYSTEM_CONFIG', icon: Settings },
    { label: 'Observability', type: 'header', className: 'pt-4' },
    { href: '/security', label: 'SECURITY_MANIFEST', icon: ShieldCheck },
    { href: '/resilience', label: 'SELF_HEALING', icon: Zap },
  ];

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 border-b border-white/10 bg-black/80 backdrop-blur-md z-40 px-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className={`w-8 h-8 bg-${THEME.COLORS.PRIMARY} rounded-sm flex items-center justify-center text-black font-bold`}>
            C
          </div>
          <h1 className="text-lg font-bold tracking-tighter">CLAW_CENTER</h1>
        </Link>
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 hover:bg-white/5 rounded-md text-white"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 lg:w-64 border-r border-white/10 flex flex-col p-6 space-y-8 bg-[#0d0d0d] lg:bg-black/20 shrink-0 transition-transform duration-300 lg:relative lg:translate-x-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between lg:justify-start gap-3">
          <Link href="/" className="flex items-center gap-3 group">
            <div className={`w-8 h-8 bg-${THEME.COLORS.PRIMARY} rounded-sm flex items-center justify-center text-black font-bold group-hover:scale-105 transition-transform`}>
              C
            </div>
            <h1 className="text-xl font-bold tracking-tighter">CLAW_CENTER</h1>
          </Link>
          <button className="lg:hidden p-1 text-white/100" onClick={() => setIsOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 text-sm overflow-y-auto pr-2 custom-scrollbar">
          {navItems.map((item, idx) => {
            if (item.type === 'header') {
              return (
                <div key={idx} className={`text-white/100 px-2 uppercase text-[10px] tracking-widest font-bold mb-2 ${item.className || ''}`}>
                  {item.label}
                </div>
              );
            }

            const isActive = item.activePaths 
              ? item.activePaths.some(p => p === pathname || (p !== '/' && pathname?.startsWith(p)))
              : pathname === item.href;
            
            const Icon = item.icon;

            return (
              <Link 
                key={idx}
                href={item.href!} 
                className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded transition-all group ${
                  isActive 
                    ? `bg-${THEME.COLORS.PRIMARY}/10 text-${THEME.COLORS.PRIMARY} border-l-2 border-${THEME.COLORS.PRIMARY}` 
                    : 'text-white/100 hover:bg-white/5 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  {Icon && <Icon size={16} className={isActive ? `text-${THEME.COLORS.PRIMARY}` : 'text-white/100 group-hover:text-white/100'} />}
                  <span className="font-medium tracking-tight uppercase text-xs">{item.label}</span>
                </div>
                {isActive && <ChevronRight size={12} className={`text-${THEME.COLORS.PRIMARY}`} />}
              </Link>
            );
          })}
        </nav>

        <div className="pt-6 border-t border-white/5 space-y-4">
          <div className="bg-white/5 rounded p-3">
            <div className="text-[10px] text-white/90 font-bold uppercase tracking-wider">Node Status</div>
            <div className={`text-[10px] text-${THEME.COLORS.PRIMARY} mt-1.5 flex items-center gap-2`}>
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full bg-${THEME.COLORS.PRIMARY} opacity-75`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 bg-${THEME.COLORS.PRIMARY}`}></span>
              </span>
              SYSTEM_ONLINE
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-white/50 font-bold tracking-widest">
            <span>v1.0.0-PROTOTYPE</span>
            <span className="text-white/10 px-1 border border-white/10 rounded">2026</span>
          </div>
        </div>
      </aside>
    </>
  );
}
