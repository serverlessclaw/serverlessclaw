'use client';

import React, { useState, useEffect } from 'react';
import { 
  Activity, 
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
  Calendar,
  BrainCircuit,
  Building2,
  Vote,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { THEME } from '@/lib/theme';
import { UI_STRINGS, ROUTES } from '@/lib/constants';
import Typography from '@/components/ui/Typography';
import Button from '@/components/ui/Button';

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    { href: ROUTES.SCHEDULING, label: UI_STRINGS.SCHEDULING, icon: Calendar },
    { href: ROUTES.WORKSPACES, label: UI_STRINGS.WORKSPACES, icon: Building2 },
    { href: ROUTES.COLLABORATION, label: UI_STRINGS.CONSENSUS, icon: Vote },
    
    { label: UI_STRINGS.INFRA_HEADER, type: 'header' },
    { href: ROUTES.SYSTEM_PULSE, label: UI_STRINGS.SYSTEM_PULSE, icon: Share2 },
    { href: ROUTES.LOCKS, label: UI_STRINGS.SESSION_TRAFFIC, icon: Lock },
    { href: ROUTES.RESILIENCE, label: UI_STRINGS.SELF_HEALING, icon: Zap },
    { href: ROUTES.COGNITIVE_HEALTH, label: UI_STRINGS.COGNITIVE_HEALTH, icon: BrainCircuit },
    { href: ROUTES.SECURITY, label: UI_STRINGS.SECURITY_MANIFEST, icon: Settings },
    { href: ROUTES.SETTINGS, label: UI_STRINGS.CONFIG, icon: Settings },
  ];

  return (
    <>
      {/* Mobile Header - Visible only on small screens */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 border-b border-white/10 bg-black/80 backdrop-blur-md z-40 px-6 flex items-center justify-between">
        <Link href={ROUTES.HOME} className="flex items-center gap-3 group">
          <div className="relative w-8 h-8 rounded-sm overflow-hidden group-hover:scale-105 transition-transform">
            <Image
              src="/logo.png"
              alt="ClawCenter Logo"
              fill
              className="object-contain"
            />
          </div>
          <Typography variant="h3" weight="black" className="text-lg tracking-tighter">ClawCenter</Typography>
        </Link>
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
        fixed inset-y-0 left-0 z-50 w-72 lg:w-64 border-r border-white/10 flex flex-col p-6 space-y-8 bg-[#0d0d0d] lg:bg-black/20 shrink-0 transition-transform duration-300 lg:relative lg:translate-x-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between lg:justify-start gap-3">
          <Link href={ROUTES.HOME} className="flex items-center gap-3 group">
            <div className="relative w-8 h-8 rounded-sm overflow-hidden group-hover:scale-105 transition-transform">
              <Image
                src="/logo.png"
                alt="ClawCenter Logo"
                fill
                className="object-contain"
              />
            </div>
            <Typography variant="h2" weight="black" className="text-xl tracking-tighter">ClawCenter</Typography>
          </Link>
          <div className="lg:hidden flex items-center">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setIsOpen(false)}
              className="p-1 text-white h-auto"
              icon={<X size={20} />}
            />
          </div>
        </div>

        <nav className="flex-1 space-y-1 text-sm overflow-y-auto pr-2 custom-scrollbar">
          {navItems.map((item, idx) => {
            if (item.type === 'header') {
              return (
                <div key={idx} className={`text-white/100 px-2 text-[10px] tracking-[0.2em] font-black mb-2 ${idx !== 0 ? 'pt-4' : ''}`}>
                  {item.label}
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
                className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded transition-all group ${
                  isActive 
                    ? `bg-${THEME.COLORS.PRIMARY}/10 text-${THEME.COLORS.PRIMARY} border-l-2 border-${THEME.COLORS.PRIMARY}` 
                    : 'text-white/100 hover:bg-white/5 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  {Icon && <Icon size={16} className={isActive ? `text-${THEME.COLORS.PRIMARY}` : 'text-white/100 group-hover:text-white/100'} />}
                  <Typography 
                    variant="caption" 
                    weight={isActive ? "bold" : "medium"}
                    className={`${isActive ? `text-${THEME.COLORS.PRIMARY}` : ''} text-xs tracking-tight`}
                  >
                    {item.label}
                  </Typography>
                </div>
                {isActive && <ChevronRight size={12} className={`text-${THEME.COLORS.PRIMARY}`} />}
              </Link>
            );
          })}
        </nav>

        <Link href={ROUTES.SYSTEM_PULSE} className="block pt-6 border-t border-white/5 space-y-4 group/status">
          <div className="bg-white/5 rounded p-3 group-hover/status:bg-white/10 transition-colors cursor-pointer">
            <Typography variant="mono" weight="bold" className="text-[10px] text-white/90 tracking-wider uppercase">SYSTEM_STATUS</Typography>
            <div className={`text-[10px] text-${THEME.COLORS.PRIMARY} mt-1.5 flex items-center gap-2 font-bold uppercase`}>
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full bg-${THEME.COLORS.PRIMARY} opacity-75`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 bg-${THEME.COLORS.PRIMARY}`}></span>
              </span>
              SYSTEM_ONLINE &gt; CONNECTED
            </div>
          </div>
        </Link>
      </aside>
    </>
  );}
