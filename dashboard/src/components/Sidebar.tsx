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
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  Brain,
  Wrench,
  Server,
  Calendar,
  BrainCircuit,
  Building2,
  Vote,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ROUTES } from '@/lib/constants';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { useUICommand } from '@/components/Providers/UICommandProvider';
import { useTheme } from 'next-themes';
import Typography from '@/components/ui/Typography';
import Button from '@/components/ui/Button';

/**
 * Main application sidebar component.
 * Provides global navigation and system status indicators.
 * Supports mobile drawer mode and desktop collapse mode.
 */
export default function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const { isSidebarCollapsed: isCollapsed, setSidebarCollapsed } = useUICommand();
  const { t, locale, setLocale } = useTranslations();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const toggleCollapse = () => {
    setSidebarCollapsed(!isCollapsed);
  };

  // Close mobile sidebar on navigation
  useEffect(() => {
    if (isOpen) {
       
      const timer = setTimeout(() => setIsOpen(false), 0);
      return () => clearTimeout(timer);
    }
  }, [pathname, isOpen]);

  const navItems = [
    { label: t('OPERATIONS'), type: 'header' },
    { href: ROUTES.CHAT, label: t('CHAT_DIRECT'), icon: MessageSquare },
    {
      href: ROUTES.TRACE,
      label: t('TRACE_INTEL'),
      icon: Activity,
      activePaths: [ROUTES.TRACE, '/trace'],
    },
    { href: ROUTES.SYSTEM_PULSE, label: t('SYSTEM_PULSE'), icon: Share2 },

    { label: t('INTELLIGENCE'), type: 'header' },
    { href: ROUTES.AGENTS, label: t('AGENTS'), icon: Users },
    { href: ROUTES.MEMORY, label: t('MEMORY_RESERVE'), icon: Brain },
    { href: ROUTES.CAPABILITIES, label: t('CAPABILITIES'), icon: Wrench },
    { href: ROUTES.COGNITIVE_HEALTH, label: t('COGNITIVE_HEALTH'), icon: BrainCircuit },

    { label: t('GROWTH'), type: 'header' },
    { href: ROUTES.PIPELINE, label: t('EVOLUTION_PIPELINE'), icon: Server },
    { href: ROUTES.SCHEDULING, label: t('SCHEDULING'), icon: Calendar },
    { href: ROUTES.WORKSPACES, label: t('WORKSPACES'), icon: Building2 },
    { href: ROUTES.COLLABORATION, label: t('CONSENSUS'), icon: Vote },

    { label: t('GOVERNANCE'), type: 'header' },
    { href: ROUTES.SECURITY, label: t('SECURITY_MANIFEST'), icon: Lock },
    { href: ROUTES.RESILIENCE, label: t('SELF_HEALING'), icon: Zap },
    { href: ROUTES.LOCKS, label: t('SESSION_TRAFFIC'), icon: Activity },
    { href: ROUTES.SETTINGS, label: t('CONFIG'), icon: Settings },
  ];

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 border-b border-border bg-background/80 backdrop-blur-md z-40 px-6 flex items-center justify-between">
        <Link href={ROUTES.HOME} className="flex items-center gap-3 group shrink-0">
          <div className="relative w-8 h-8 flex-shrink-0 rounded-sm overflow-hidden group-hover:scale-105 transition-transform">
            <Image
              src="/icon.png"
              alt="ClawCenter Logo"
              width={32}
              height={32}
              className="object-contain"
            />
          </div>
          <Typography variant="h3" weight="black" className="text-lg tracking-tighter shrink-0">
            ClawCenter
          </Typography>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Toggle navigation"
          className="p-2 h-auto text-foreground"
          icon={isOpen ? <X size={24} /> : <Menu size={24} />}
        />
      </div>

      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`
        fixed inset-y-0 left-0 z-50 border-r border-border flex flex-col bg-background transition-all duration-300 ease-in-out lg:relative lg:translate-x-0
        ${isOpen ? 'translate-x-0 w-72' : '-translate-x-full lg:translate-x-0'}
        ${isCollapsed ? 'lg:w-16 p-2' : 'lg:w-64 p-2'}
      `}
      >
        <div className={`flex items-center justify-between gap-3 mb-6 ${isCollapsed ? 'flex-col' : 'px-2'} pt-4`}>
          <Link href={ROUTES.HOME} className="flex items-center gap-3 group shrink-0">
            <div className="relative w-8 h-8 flex-shrink-0 rounded-sm overflow-hidden group-hover:scale-105 transition-transform">
              <Image
                src="/icon.png"
                alt="ClawCenter Logo"
                width={32}
                height={32}
                className="object-contain"
              />
            </div>
            {!isCollapsed && (
              <Typography variant="h2" weight="black" className="text-xl tracking-tighter shrink-0 transition-opacity">
                ClawCenter
              </Typography>
            )}
          </Link>
          
          <div className="flex items-center gap-2">
            {/* Close Toggle - Mobile Only */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="lg:hidden p-1 text-foreground h-auto"
              icon={<X size={20} />}
            />
          </div>
        </div>

        {/* Desktop Fold Toggle - Floating on right edge */}
        <button
          onClick={toggleCollapse}
          className="hidden lg:flex absolute top-6 -right-3 z-[60] h-6 w-6 rounded-full border border-border bg-background shadow-sm items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all"
          title={isCollapsed ? t('UNFOLD') : t('FOLD')}
        >
          {isCollapsed ? <PanelLeftOpen size={12} /> : <PanelLeftClose size={12} />}
        </button>

        {/* Navigation */}
        <nav className="flex-1 space-y-0 text-sm overflow-y-auto overflow-x-hidden custom-scrollbar">
          {navItems.map((item, idx) => {
            if (item.type === 'header') {
              if (isCollapsed) return <div key={idx} className="h-px bg-border/40 my-1.5 mx-2" />;
              return (
                <div
                  key={idx}
                  className="text-muted-foreground px-2 text-[9px] tracking-[0.2em] font-black mb-1 pt-2 first:pt-0 uppercase"
                >
                  {item.label}
                </div>
              );
            }

            const isActive = item.activePaths
              ? item.activePaths.some(
                  (p) => p === pathname || (p !== ROUTES.HOME && pathname?.startsWith(p))
                )
              : pathname === item.href;

            const Icon = item.icon;

            return (
              <Link
                key={idx}
                href={item.href!}
                title={isCollapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded transition-all group relative ${
                  isActive
                    ? 'bg-cyber-green/10 text-cyber-green'
                    : 'text-foreground/70 hover:bg-foreground/5 hover:text-foreground'
                } ${isCollapsed ? 'justify-center py-0.5' : 'justify-between px-2 py-0.5'}`}
              >
                {isActive && (
                  <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-cyber-green rounded-full shadow-[0_0_8px_rgba(0,255,157,0.5)]" />
                )}
                <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
                  {Icon && (
                    <div className="w-8 h-6 flex items-center justify-center shrink-0">
                      <Icon
                        size={14}
                        className={
                          isActive
                            ? 'text-cyber-green'
                            : 'text-muted-foreground group-hover:text-foreground'
                        }
                      />
                    </div>
                  )}
                  {!isCollapsed && (
                    <Typography
                      variant="caption"
                      weight={isActive ? 'bold' : 'medium'}
                      className={`${isActive ? 'text-cyber-green' : ''} text-xs tracking-tight whitespace-nowrap`}
                    >
                      {item.label}
                    </Typography>
                  )}
                </div>
                {!isCollapsed && isActive && <ChevronRight size={10} className="text-cyber-green" />}
              </Link>
            );
          })}
          

        </nav>

        {/* Footer */}
        <div className={`block pt-2 border-t border-border space-y-2 ${isCollapsed ? 'flex flex-col items-center' : ''}`}>
          <Link
            href={ROUTES.SYSTEM_PULSE}
            className="block group/status w-full"
            title={isCollapsed ? t('SYSTEM_STATUS') : undefined}
          >
            <div className={`bg-foreground/5 rounded transition-colors cursor-pointer ${isCollapsed ? 'py-0 flex justify-center' : 'px-2 py-2'} group-hover/status:bg-foreground/10`}>
              {isCollapsed ? (
                <div className="w-8 h-6 flex items-center justify-center shrink-0">
                   <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyber-green opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-cyber-green"></span>
                   </span>
                </div>
              ) : (
                <>
                  <Typography
                    variant="mono"
                    weight="bold"
                    className="text-[10px] text-foreground/90 tracking-wider uppercase"
                  >
                    {t('SYSTEM_STATUS')}
                  </Typography>
                  <div className="text-[10px] text-cyber-green mt-0 flex items-center gap-3 font-bold uppercase">
                    <div className="w-8 h-6 flex items-center justify-center shrink-0">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyber-green opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-cyber-green"></span>
                      </span>
                    </div>
                    {t('SYSTEM_ONLINE')}
                  </div>
                </>
              )}
            </div>
          </Link>

          {!isCollapsed ? (
            <div className="flex flex-col gap-1 px-2 pb-1">
              <div className="flex items-center justify-between">
                <Typography variant="caption" className="text-muted-foreground text-[10px] uppercase tracking-wider font-mono">
                  {t('LANGUAGE')}
                </Typography>
                <div className="flex gap-2 text-[10px] font-mono">
                  <button
                    onClick={(e) => { e.preventDefault(); setLocale('en'); }}
                    className={`transition-colors ${mounted && locale === 'en' ? 'text-foreground font-bold' : 'text-muted-foreground hover:text-foreground/70'}`}
                  >
                    EN
                  </button>
                  <span className="text-foreground/20">|</span>
                  <button
                    onClick={(e) => { e.preventDefault(); setLocale('cn'); }}
                    className={`transition-colors ${mounted && locale === 'cn' ? 'text-foreground font-bold' : 'text-muted-foreground hover:text-foreground/70'}`}
                  >
                    中文
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Typography variant="caption" className="text-muted-foreground text-[10px] uppercase tracking-wider font-mono">
                  {t('THEME')}
                </Typography>
                <div className="flex gap-3 text-muted-foreground">
                  <button onClick={() => setTheme('light')} className={`p-1 rounded hover:bg-foreground/5 transition-colors ${mounted && theme === 'light' ? 'text-cyber-green' : ''}`}>
                    <Sun size={12} />
                  </button>
                  <button onClick={() => setTheme('dark')} className={`p-1 rounded hover:bg-foreground/5 transition-colors ${mounted && theme === 'dark' ? 'text-cyber-green' : ''}`}>
                    <Moon size={12} />
                  </button>
                  <button onClick={() => setTheme('system')} className={`p-1 rounded hover:bg-foreground/5 transition-colors ${mounted && theme === 'system' ? 'text-cyber-green' : ''}`}>
                    <Monitor size={12} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 pb-0">
               <div className="w-8 h-6 flex items-center justify-center">
                 <button 
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className={`p-1 rounded-full bg-foreground/5 transition-colors ${mounted ? 'text-muted-foreground hover:text-cyber-green' : 'text-transparent'}`}
                 >
                  {mounted ? (theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />) : <div className="w-3 h-3" />}
                 </button>
               </div>
               <div className="w-8 h-6 flex items-center justify-center">
                 <button 
                  onClick={() => setLocale(locale === 'en' ? 'cn' : 'en')}
                  className={`text-[10px] font-mono font-bold transition-colors uppercase ${mounted ? 'text-muted-foreground hover:text-cyber-green' : 'text-transparent'}`}
                 >
                  {mounted ? (locale === 'en' ? 'CN' : 'EN') : '..'}
                 </button>
               </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
