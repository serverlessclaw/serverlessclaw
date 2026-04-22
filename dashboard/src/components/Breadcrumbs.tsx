'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import { ROUTES } from '@/lib/constants';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

/**
 * Dynamic Breadcrumbs component.
 * Maps URL segments to translated labels and provides a visual navigation trail.
 */
const Breadcrumbs: React.FC = () => {
  const pathname = usePathname();
  const { t } = useTranslations();

  if (pathname === ROUTES.HOME) return null;

  const pathSegments = pathname.split('/').filter((segment) => segment !== '');

  // Mapping path segments to translation keys
  const getLabel = (segment: string) => {
    const map: Record<string, string> = {
      agents: 'AGENTS',
      trace: 'TRACE_INTEL',
      chat: 'CHAT_DIRECT',
      observability: 'OBSERVABILITY',
      security: 'SECURITY_MANIFEST',
      settings: 'CONFIG',
      pipeline: 'EVOLUTION_PIPELINE',
      memory: 'MEMORY_RESERVE',
      capabilities: 'CAPABILITIES',
      workspaces: 'WORKSPACES',
      scheduling: 'SCHEDULING',
      collaboration: 'CONSENSUS',
      resilience: 'TAB_RESILIENCE',
      'system-pulse': 'SYSTEM_PULSE',
      'cognitive-health': 'COGNITIVE_HEALTH',
      locks: 'SESSION_TRAFFIC',
      sessions: 'SESSIONS',
    };

    return map[segment] || segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
  };

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1"
    >
      <Link
        href={ROUTES.HOME}
        className="text-muted hover:text-cyber-green transition-colors flex items-center shrink-0"
      >
        <Home size={12} className="mr-1" />
        <Typography variant="mono" className="text-[10px] uppercase font-bold tracking-widest">
          HUB
        </Typography>
      </Link>

      {pathSegments.map((segment, index) => {
        const href = `/${pathSegments.slice(0, index + 1).join('/')}`;
        const isLast = index === pathSegments.length - 1;
        const label = getLabel(segment);

        return (
          <React.Fragment key={href}>
            <ChevronRight size={10} className="text-muted/40 shrink-0" />
            {isLast ? (
              <Typography
                variant="mono"
                className="text-[10px] uppercase font-black text-cyber-green tracking-widest shrink-0"
              >
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {t(label as any) || label}
              </Typography>
            ) : (
              <Link
                href={href}
                className="text-muted hover:text-cyber-green transition-colors shrink-0"
              >
                <Typography
                  variant="mono"
                  className="text-[10px] uppercase font-bold tracking-widest"
                >
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {t(label as any) || label}
                </Typography>
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};

export default Breadcrumbs;
