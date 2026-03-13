'use client';

import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  ShieldCheck, 
  MessageSquare, 
  Settings, 
  Lock, 
  Share2, 
  Zap, 
  Menu, 
  X,
  ChevronRight,
  Users,
  Brain,
  Wrench,
  Server,
  Sun,
  Moon
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { THEME } from '@/lib/theme';
import { UI_STRINGS, ROUTES } from '@/lib/constants';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

/**
 * Main application sidebar component.
 * Provides global navigation and system status indicators.
 * Uses a responsive design that collapses into a drawer on mobile.
 */
export default function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  // Close sidebar on navigation to improve mobile UX
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const navItems = [
    { label: UI_STRINGS.INTELLIGENCE_HEADER, type: 'header' },
    { href: ROUTES.CHAT, label: UI_STRINGS.CHAT_DIRECT, icon: MessageSquare },
    { href: ROUTES.TRACE, label: UI_STRINGS.TRACE_INTEL, icon: Activity, activePaths: [ROUTES.TRACE, '/trace'] },
    
    { label: UI_STRINGS.EVOLUTION_HEADER, type: 'header' },
    { href: ROUTES.AGENTS, label: UI_STRINGS.AGENTS, icon: Users },
    { href: ROUTES.MEMORY, label: UI_STRINGS.MEMORY_RESERVE, icon: Brain },
    { href: ROUTES.PIPELINE, label: UI_STRINGS.EVOLUTION_PIPELINE, icon: Server },
    { href: ROUTES.CAPABILITIES, label: UI_STRINGS.CAPABILITIES, icon: Wrench },
    
    { label: UI_STRINGS.INFRA_HEADER, type: 'header' },
    { href: ROUTES.SYSTEM_PULSE, label: UI_STRINGS.SYSTEM_PULSE, icon: Share2 },
    { href: ROUTES.LOCKS, label: UI_STRINGS.SESSION_TRAFFIC, icon: Lock },
    { href: ROUTES.SECURITY, label: UI_STRINGS.SECURITY_MANIFEST, icon: ShieldCheck },
    { href: ROUTES.RESILIENCE, label: UI_STRINGS.SELF_HEALING, icon: Zap },
    { href: ROUTES.SETTINGS, label: UI_STRINGS.CONFIG, icon: Settings },
  ];

  return (
    <>
      {/* Mobile Header - Visible only on small screens */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 border-b border-white/10 bg-black/80 backdrop-blur-md z-40 px-6 flex items-center justify-between">
        <div className="flex-1 flex justify-center lg:justify-start">
          <Link href={ROUTES.HOME} className="flex items-center group">
            <Image 
              src="/logo-text-transparent.png" 
              alt="Claw Center" 
              width={140} 
              height={40} 
              priority
              unoptimized
              className="h-8 w-auto object-contain"
            />
          </Link>
        </div>
        <Button 
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Toggle navigation"
          className="p-2 h-auto text-white"
          icon={isOpen ? <X size={24} /> : <Menu size={24} />}
        />
      </div>

      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 lg:w-64 border-r border-white/10 flex flex-col p-6 bg-[#0d0d0d] lg:bg-black/20 shrink-0 transition-transform duration-300 lg:relative lg:translate-x-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-center w-full mb-2">
          <Link href={ROUTES.HOME} className="flex items-center group">
            <Image 
              src="/logo-text-transparent.png" 
              alt="Claw Center" 
              width={180} 
              height={54} 
              priority
              unoptimized
              className="h-12 w-auto object-contain group-hover:scale-[1.02] transition-transform"
            />
          </Link>
          <div className="absolute right-6 flex items-center gap-2 lg:hidden">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setIsOpen(false)}
              className="p-1 text-white h-auto"
              icon={<X size={20} />}
            />
          </div>
        </div>

        <nav className="flex-1 text-sm overflow-y-auto pr-2 custom-scrollbar mt-2">
          {navItems.map((item, idx) => {
            if (item.type === 'header') {
              return (
                <div key={idx} className={`px-3 mb-1 ${idx === 0 ? 'mt-0' : 'mt-4'}`}>
                  <Typography variant="mono" weight="black" color="muted" className="text-[10px] uppercase tracking-[0.3em] opacity-70">
                    {item.label}
                  </Typography>
                </div>
              );
            }

            const isActive = item.activePaths 
              ? item.activePaths.some(p => p === pathname || (p !== ROUTES.HOME && pathname?.startsWith(p)))
              : pathname === item.href;

            const Icon = item.icon;

            return (
              <Link 
                key={idx}
                href={item.href!} 
                className={`flex items-center justify-between gap-3 px-3 py-1.5 rounded-sm transition-all group mb-0.5 ${
                  isActive 
                    ? `bg-${THEME.COLORS.PRIMARY}/10 text-${THEME.COLORS.PRIMARY} border-l-2 border-${THEME.COLORS.PRIMARY} shadow-[inset_0_0_10px_rgba(0,255,163,0.05)]` 
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  {Icon && <Icon size={14} className={isActive ? `text-${THEME.COLORS.PRIMARY}` : 'text-white/20 group-hover:text-white/80 transition-colors'} />}
                  <Typography 
                    variant="caption" 
                    weight={isActive ? "bold" : "medium"}
                    className={`${isActive ? `text-${THEME.COLORS.PRIMARY}` : 'tracking-wide'} uppercase text-[11px]`}
                  >
                    {item.label}
                  </Typography>
                </div>
                {isActive && <div className={`w-1 h-1 rounded-full bg-${THEME.COLORS.PRIMARY} shadow-[0_0_8px_rgba(0,255,163,0.8)]`} />}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between px-1 opacity-30">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--cyber-green)]" />
            <Typography variant="mono" className="text-[8px]">ONLINE</Typography>
          </div>
          <Typography variant="mono" className="text-[8px]">v1.0.0-PROTOTYPE</Typography>
        </div>
      </aside>
    </>
  );
}
