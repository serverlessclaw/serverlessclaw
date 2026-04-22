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
  Keyboard,
  LogOut,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { ROUTES } from '@/lib/constants';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { useUICommand } from '@/components/Providers/UICommandProvider';
import { useTheme } from 'next-themes';
import Typography from '@/components/ui/Typography';
import Button from '@/components/ui/Button';
import { useRealtimeContext } from '@/components/Providers/RealtimeProvider';
import CyberTooltip from '@/components/CyberTooltip';
import { logger } from '@claw/core/lib/logger';

/**
 * Main application sidebar component.
 * Provides global navigation and system status indicators.
 * Supports mobile drawer mode and desktop collapse mode.
 */
export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const { isSidebarCollapsed: isCollapsed, setSidebarCollapsed, setActiveModal } = useUICommand();
  const { t, locale, setLocale } = useTranslations();
  const { theme, setTheme } = useTheme();
  const { isConnected } = useRealtimeContext();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleCollapse = () => {
    setSidebarCollapsed(!isCollapsed);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      logger.error('Logout failed:', error);
    } finally {
      router.push('/login');
      router.refresh();
    }
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
    {
      href: ROUTES.CHAT,
      label: t('CHAT_DIRECT'),
      subtitle: t('CHAT_SUBTITLE'),
      icon: MessageSquare,
    },
    {
      href: ROUTES.TRACE,
      label: t('TRACE_INTEL'),
      subtitle: t('TRACE_SUBTITLE'),
      icon: Activity,
      activePaths: [ROUTES.TRACE, '/trace'],
    },
    {
      href: ROUTES.PIPELINE,
      label: t('EVOLUTION_PIPELINE'),
      subtitle: t('PIPELINE_SUBTITLE'),
      icon: Server,
    },
    {
      href: ROUTES.SCHEDULING,
      label: t('SCHEDULING'),
      subtitle: t('SCHEDULING_SUBTITLE'),
      icon: Calendar,
    },
    {
      href: ROUTES.COLLABORATION,
      label: t('CONSENSUS'),
      subtitle: t('COLLABORATION_SUBTITLE'),
      icon: Vote,
    },

    { label: t('INTELLIGENCE'), type: 'header' },
    { href: ROUTES.AGENTS, label: t('AGENTS'), subtitle: t('AGENTS_SUBTITLE'), icon: Users },
    {
      href: ROUTES.MEMORY,
      label: t('MEMORY_RESERVE'),
      subtitle: t('MEMORY_SUBTITLE'),
      icon: Brain,
    },
    {
      href: ROUTES.CAPABILITIES,
      label: t('CAPABILITIES'),
      subtitle: t('CAPABILITIES_SUBTITLE'),
      icon: Wrench,
    },

    { label: t('OBSERVABILITY'), type: 'header' },
    {
      href: ROUTES.OBSERVABILITY,
      label: t('OBSERVABILITY'),
      subtitle: t('SYSPULSE_SUBTITLE'),
      icon: BrainCircuit,
      activePaths: [
        ROUTES.OBSERVABILITY,
        ROUTES.SYSTEM_PULSE,
        ROUTES.RESILIENCE,
        ROUTES.COGNITIVE_HEALTH,
        ROUTES.LOCKS,
      ],
    },

    { label: t('GOVERNANCE'), type: 'header' },
    {
      href: ROUTES.SECURITY,
      label: t('SECURITY_MANIFEST'),
      subtitle: t('SECURITY_SUBTITLE'),
      icon: Lock,
    },
    {
      href: ROUTES.WORKSPACES,
      label: t('WORKSPACES'),
      subtitle: t('WORKSPACES_SUBTITLE'),
      icon: Building2,
    },
    { href: ROUTES.SETTINGS, label: t('CONFIG'), subtitle: t('SETTINGS_SUBTITLE'), icon: Settings },
  ];

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 border-b border-border bg-background/80 backdrop-blur-md z-40 px-6 flex items-center justify-between">
        <Link href={ROUTES.HOME} className="flex items-center gap-3 group shrink-0">
          <div className="relative w-8 h-8 shrink-0 rounded-sm overflow-hidden group-hover:scale-105 transition-transform">
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
        <div
          className={`flex items-center justify-between gap-3 mb-6 ${isCollapsed ? 'flex-col' : 'px-2'} pt-4`}
        >
          <Link href={ROUTES.HOME} className="flex items-center gap-3 group shrink-0">
            <div className="relative w-8 h-8 shrink-0 rounded-sm overflow-hidden group-hover:scale-105 transition-transform">
              <Image
                src="/icon.png"
                alt="ClawCenter Logo"
                width={32}
                height={32}
                className="object-contain"
              />
            </div>
            {!isCollapsed && (
              <Typography
                variant="h2"
                weight="black"
                className="text-xl tracking-tighter shrink-0 transition-opacity"
              >
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
          className="hidden lg:flex absolute top-6 -right-3 z-60 h-6 w-6 rounded-full border border-border bg-background shadow-sm items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-all"
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

            const navLink = (
              <Link
                href={item.href!}
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
                {!isCollapsed && isActive && (
                  <ChevronRight size={10} className="text-cyber-green" />
                )}
              </Link>
            );

            if (isCollapsed) {
              return (
                <CyberTooltip
                  key={idx}
                  position="right"
                  showIcon={false}
                  className="w-full"
                  content={
                    <div className="flex flex-col gap-1">
                      <Typography
                        variant="caption"
                        weight="bold"
                        className="text-cyber-green text-[10px] uppercase tracking-wider"
                      >
                        {item.label}
                      </Typography>
                      <Typography className="text-[9px] leading-tight text-foreground/70">
                        {item.subtitle}
                      </Typography>
                    </div>
                  }
                >
                  {navLink}
                </CyberTooltip>
              );
            }

            return <React.Fragment key={idx}>{navLink}</React.Fragment>;
          })}
        </nav>

        {/* Footer */}
        <div
          className={`block pt-2 border-t border-border space-y-1.5 pb-2 ${isCollapsed ? 'flex flex-col items-center' : ''}`}
        >
          {/* System Status Row */}
          {isCollapsed ? (
            <CyberTooltip
              position="right"
              showIcon={false}
              className="w-full"
              content={
                <div className="flex flex-col gap-1">
                  <Typography
                    variant="caption"
                    weight="bold"
                    className="text-cyber-green text-[10px] uppercase tracking-wider"
                  >
                    {t('SYSTEM_STATUS')}
                  </Typography>
                  <Typography className="text-[9px] leading-tight text-foreground/70">
                    {isConnected ? t('CONNECTED') : t('SYSTEM_OFFLINE')}
                  </Typography>
                </div>
              }
            >
              <Link href={ROUTES.SYSTEM_PULSE} className="block group/status w-full">
                <div className="bg-foreground/5 rounded transition-colors cursor-pointer py-1.5 flex justify-center group-hover/status:bg-foreground/10 border border-transparent hover:border-cyber-green/20 mx-1">
                  <div className="relative flex h-2 w-2">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isConnected ? 'bg-cyber-green' : 'bg-amber-500'} opacity-75`}
                    ></span>
                    <span
                      className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? 'bg-cyber-green' : 'bg-amber-500'}`}
                    ></span>
                  </div>
                </div>
              </Link>
            </CyberTooltip>
          ) : (
            <Link href={ROUTES.SYSTEM_PULSE} className="block group/status w-full px-2">
              <div className="bg-foreground/5 rounded transition-colors cursor-pointer px-2 py-1.5 group-hover/status:bg-foreground/10 flex items-center justify-between border border-transparent hover:border-cyber-green/20">
                <div className="flex items-center gap-2">
                  <div className="relative flex h-1.5 w-1.5">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isConnected ? 'bg-cyber-green' : 'bg-amber-500'} opacity-75`}
                    ></span>
                    <span
                      className={`relative inline-flex rounded-full h-1.5 w-1.5 ${isConnected ? 'bg-cyber-green' : 'bg-amber-500'}`}
                    ></span>
                  </div>
                  <Typography
                    variant="mono"
                    weight="bold"
                    className="text-[10px] text-foreground/80 tracking-wider uppercase"
                  >
                    {t('SYSTEM_STATUS')}
                  </Typography>
                </div>
                <Typography
                  variant="mono"
                  className={`text-[9px] font-bold uppercase ${isConnected ? 'text-cyber-green' : 'text-amber-500'}`}
                >
                  {isConnected ? t('CONNECTED') : t('SYSTEM_OFFLINE')}
                </Typography>
              </div>
            </Link>
          )}

          {/* Keyboard Shortcuts Row */}
          {isCollapsed ? (
            <CyberTooltip
              position="right"
              showIcon={false}
              content={t('CHAT_KEYBOARD_SHORTCUTS_TITLE')}
            >
              <button
                onClick={() => setActiveModal('shortcuts')}
                className="w-full flex justify-center py-1.5 text-muted-foreground hover:text-cyber-green transition-colors bg-foreground/5 rounded border border-transparent hover:border-cyber-green/20 mx-1"
              >
                <Keyboard size={14} />
              </button>
            </CyberTooltip>
          ) : (
            <div className="px-2">
              <button
                onClick={() => setActiveModal('shortcuts')}
                className="w-full bg-foreground/5 rounded transition-colors cursor-pointer px-2 py-1.5 group hover:bg-foreground/10 flex items-center justify-between border border-transparent hover:border-cyber-green/20"
              >
                <div className="flex items-center gap-2 text-muted-foreground group-hover:text-foreground">
                  <Keyboard size={14} className="group-hover:text-cyber-green transition-colors" />
                  <Typography
                    variant="mono"
                    weight="bold"
                    className="text-[10px] tracking-wider uppercase"
                  >
                    {t('CHAT_KEYBOARD_SHORTCUTS_TITLE')}
                  </Typography>
                </div>
                <div className="bg-foreground/10 rounded px-1 py-0.5 border border-border/50 group-hover:border-cyber-green/30">
                  <Typography variant="mono" className="text-[9px] font-bold text-cyber-green">
                    ?
                  </Typography>
                </div>
              </button>
            </div>
          )}

          {!isCollapsed ? (
            <div className="flex flex-col gap-1 px-2 pb-1 pt-1">
              <div className="flex items-center justify-between">
                <Typography
                  variant="caption"
                  className="text-muted-foreground text-[10px] uppercase tracking-wider font-mono"
                >
                  {t('LANGUAGE')}
                </Typography>
                <div className="flex gap-2 text-[10px] font-mono">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setLocale('en');
                    }}
                    className={`transition-colors ${mounted && locale === 'en' ? 'text-foreground font-bold' : 'text-muted-foreground hover:text-foreground/70'}`}
                  >
                    EN
                  </button>
                  <span className="text-foreground/20">|</span>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setLocale('cn');
                    }}
                    className={`transition-colors ${mounted && locale === 'cn' ? 'text-foreground font-bold' : 'text-muted-foreground hover:text-foreground/70'}`}
                  >
                    中文
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Typography
                  variant="caption"
                  className="text-muted-foreground text-[10px] uppercase tracking-wider font-mono"
                >
                  {t('THEME')}
                </Typography>
                <div className="flex gap-3 text-muted-foreground">
                  <button
                    onClick={() => setTheme('light')}
                    className={`p-1 rounded hover:bg-foreground/5 transition-colors ${mounted && theme === 'light' ? 'text-cyber-green' : ''}`}
                  >
                    <Sun size={12} />
                  </button>
                  <button
                    onClick={() => setTheme('dark')}
                    className={`p-1 rounded hover:bg-foreground/5 transition-colors ${mounted && theme === 'dark' ? 'text-cyber-green' : ''}`}
                  >
                    <Moon size={12} />
                  </button>
                  <button
                    onClick={() => setTheme('system')}
                    className={`p-1 rounded hover:bg-foreground/5 transition-colors ${mounted && theme === 'system' ? 'text-cyber-green' : ''}`}
                  >
                    <Monitor size={12} />
                  </button>
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="justify-start px-2 py-1.5 text-xs text-muted-foreground hover:text-cyber-green"
                icon={<LogOut size={12} />}
              >
                {t('LOGOUT')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 pb-0">
              <div className="w-8 h-6 flex items-center justify-center">
                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className={`p-1 rounded-full bg-foreground/5 transition-colors ${mounted ? 'text-muted-foreground hover:text-cyber-green' : 'text-transparent'}`}
                >
                  {mounted ? (
                    theme === 'dark' ? (
                      <Sun size={12} />
                    ) : (
                      <Moon size={12} />
                    )
                  ) : (
                    <div className="w-3 h-3" />
                  )}
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
              <div className="w-8 h-6 flex items-center justify-center">
                <CyberTooltip position="right" showIcon={false} content={t('LOGOUT')}>
                  <button
                    onClick={handleLogout}
                    className="p-1 rounded-full bg-foreground/5 transition-colors text-muted-foreground hover:text-cyber-green"
                  >
                    <LogOut size={12} />
                  </button>
                </CyberTooltip>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
