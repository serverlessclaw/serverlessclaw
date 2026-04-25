'use client';

import React, { useState, useEffect } from 'react';
import {
  Activity,
  MessageSquare,
  Settings,
  Lock,
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
import TenantSwitcher from '@/components/TenantSwitcher';
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

  // Close mobile sidebar on navigation
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsOpen(false), 0);
      return () => clearTimeout(timer);
    }
  }, [pathname, isOpen]);

  // Do not render sidebar on login page
  if (pathname === '/login') {
    return null;
  }

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
    {
      href: '/users',
      label: 'Users',
      subtitle: 'Manage identities and access',
      icon: Users,
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

        <TenantSwitcher isCollapsed={isCollapsed} />

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
        <div className="pt-2 border-t border-border space-y-1 pb-2">
          {/* Status & Shortcuts Row */}
          <div className={`flex items-center gap-1.5 ${isCollapsed ? 'flex-col' : 'px-2'}`}>
            <Link href={ROUTES.SYSTEM_PULSE} className="flex-1 min-w-0">
              <div
                className={`bg-foreground/5 rounded transition-colors cursor-pointer hover:bg-foreground/10 border border-transparent hover:border-cyber-green/20 flex items-center ${isCollapsed ? 'justify-center p-1.5' : 'px-2 py-1.5 justify-between'}`}
              >
                <div className="flex items-center gap-2">
                  <div className="relative flex h-1.5 w-1.5">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isConnected ? 'bg-cyber-green' : 'bg-amber-500'} opacity-75`}
                    ></span>
                    <span
                      className={`relative inline-flex rounded-full h-1.5 w-1.5 ${isConnected ? 'bg-cyber-green' : 'bg-amber-500'}`}
                    ></span>
                  </div>
                  {!isCollapsed && (
                    <Typography
                      variant="mono"
                      weight="bold"
                      className="text-[9px] text-foreground/80 tracking-wider uppercase truncate"
                    >
                      {t('SYSTEM_STATUS')}
                    </Typography>
                  )}
                </div>
                {!isCollapsed && (
                  <Typography
                    variant="mono"
                    className={`text-[8px] font-bold uppercase ${isConnected ? 'text-cyber-green' : 'text-amber-500'}`}
                  >
                    {isConnected ? 'ONLINE' : 'OFFLINE'}
                  </Typography>
                )}
              </div>
            </Link>

            {!isCollapsed && (
              <button
                onClick={() => setActiveModal('shortcuts')}
                className="p-1.5 text-muted-foreground hover:text-cyber-green transition-colors bg-foreground/5 rounded border border-transparent hover:border-cyber-green/20"
                title={t('CHAT_KEYBOARD_SHORTCUTS_TITLE')}
              >
                <Keyboard size={14} />
              </button>
            )}
          </div>

          {/* Preferences Row (Theme & Locale) */}
          <div
            className={`flex items-center justify-between ${isCollapsed ? 'flex-col gap-1' : 'px-2 pt-1'}`}
          >
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="p-1.5 rounded hover:bg-foreground/5 text-muted-foreground hover:text-cyber-green transition-colors"
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
              <button
                onClick={() => setLocale(locale === 'en' ? 'cn' : 'en')}
                className="text-[10px] font-mono font-bold text-muted-foreground hover:text-cyber-green transition-colors uppercase px-1"
              >
                {locale === 'en' ? 'CN' : 'EN'}
              </button>
            </div>

            {!isCollapsed && (
              <button
                onClick={handleLogout}
                className="p-1.5 rounded hover:bg-foreground/5 text-muted-foreground hover:text-red-500 transition-colors flex items-center gap-1.5"
                title={t('LOGOUT')}
              >
                <LogOut size={12} />
                <Typography variant="mono" className="text-[9px] font-bold uppercase">
                  EXIT
                </Typography>
              </button>
            )}

            {isCollapsed && (
              <button
                onClick={handleLogout}
                className="p-1.5 rounded hover:bg-foreground/5 text-muted-foreground hover:text-red-500 transition-colors"
              >
                <LogOut size={12} />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
