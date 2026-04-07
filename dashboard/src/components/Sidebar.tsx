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
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ROUTES } from '@/lib/constants';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { useTheme } from 'next-themes';
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
  const { t, locale, setLocale } = useTranslations();
  const { theme, setTheme } = useTheme();

  // Close sidebar on navigation to improve mobile UX
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsOpen(false);
  }, [pathname]);

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
      {/* Mobile Header - Visible only on small screens */}
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
        fixed inset-y-0 left-0 z-50 w-72 lg:w-64 border-r border-border flex flex-col p-6 space-y-6 bg-background lg:bg-background/20 shrink-0 transition-transform duration-300 lg:relative lg:translate-x-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}
      >
        <div className="flex items-center justify-between lg:justify-start gap-3">
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
            <Typography variant="h2" weight="black" className="text-xl tracking-tighter shrink-0">
              ClawCenter
            </Typography>
          </Link>
          <div className="lg:hidden flex items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="p-1 text-foreground h-auto"
              icon={<X size={20} />}
            />
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 text-sm overflow-y-auto pr-2 custom-scrollbar">
          {navItems.map((item, idx) => {
            if (item.type === 'header') {
              return (
                <div
                  key={idx}
                  className={`text-muted-foreground px-2 text-[9px] tracking-[0.2em] font-black mb-1 ${idx !== 0 ? 'pt-3' : ''} uppercase`}
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
                className={`flex items-center justify-between gap-3 px-3 py-1.5 rounded transition-all group ${
                  isActive
                    ? 'bg-cyber-green/10 text-cyber-green border-l-2 border-cyber-green'
                    : 'text-foreground/70 hover:bg-foreground/5 hover:text-foreground'
                }`}
              >
                <div className="flex items-center gap-3">
                  {Icon && (
                    <Icon
                      size={14}
                      className={
                        isActive
                          ? 'text-cyber-green'
                          : 'text-muted-foreground group-hover:text-foreground'
                      }
                    />
                  )}
                  <Typography
                    variant="caption"
                    weight={isActive ? 'bold' : 'medium'}
                    className={`${isActive ? 'text-cyber-green' : ''} text-xs tracking-tight`}
                  >
                    {item.label}
                  </Typography>
                </div>
                {isActive && <ChevronRight size={10} className="text-cyber-green" />}
              </Link>
            );
          })}
        </nav>

        <div className="block pt-6 border-t border-border space-y-4">
          <Link
            href={ROUTES.SYSTEM_PULSE}
            className="block group/status"
          >
            <div className="bg-foreground/5 rounded p-3 group-hover/status:bg-foreground/10 transition-colors cursor-pointer">
              <Typography
                variant="mono"
                weight="bold"
                className="text-[10px] text-foreground/90 tracking-wider uppercase"
              >
                {t('SYSTEM_STATUS')}
              </Typography>
              <div
                className="text-[10px] text-cyber-green mt-1.5 flex items-center gap-2 font-bold uppercase"
              >
                <span className="relative flex h-2 w-2">
                  <span
                    className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyber-green opacity-75"
                  ></span>
                  <span
                    className="relative inline-flex rounded-full h-2 w-2 bg-cyber-green"
                  ></span>
                </span>
                {t('SYSTEM_ONLINE')} &gt; {t('CONNECTED')}
              </div>
            </div>
          </Link>

          <div className="flex flex-col gap-3 px-1 pb-2">
            <div className="flex items-center justify-between">
              <Typography variant="caption" className="text-muted-foreground text-[10px] uppercase tracking-wider font-mono">
                {t('LANGUAGE')}
              </Typography>
              <div className="flex gap-2 text-[10px] font-mono">
                <button
                  onClick={(e) => { e.preventDefault(); setLocale('en'); }}
                  className={`transition-colors ${locale === 'en' ? 'text-foreground font-bold' : 'text-muted-foreground hover:text-foreground/70'}`}
                >
                  EN
                </button>
                <span className="text-foreground/20">|</span>
                <button
                  onClick={(e) => { e.preventDefault(); setLocale('cn'); }}
                  className={`transition-colors ${locale === 'cn' ? 'text-foreground font-bold' : 'text-muted-foreground hover:text-foreground/70'}`}
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
                <button
                  onClick={() => setTheme('light')}
                  className={`p-1 rounded hover:bg-foreground/5 transition-colors ${theme === 'light' ? 'text-cyber-green' : ''}`}
                  title="Light Mode"
                >
                  <Sun size={12} />
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  className={`p-1 rounded hover:bg-foreground/5 transition-colors ${theme === 'dark' ? 'text-cyber-green' : ''}`}
                  title="Dark Mode"
                >
                  <Moon size={12} />
                </button>
                <button
                  onClick={() => setTheme('system')}
                  className={`p-1 rounded hover:bg-foreground/5 transition-colors ${theme === 'system' ? 'text-cyber-green' : ''}`}
                  title="System Theme"
                >
                  <Monitor size={12} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
