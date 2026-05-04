'use client';

import React, { useState, useEffect } from 'react';
import { Building2, ChevronDown, Check, Plus, Globe } from 'lucide-react';
import { useTenant } from '@/components/Providers/TenantProvider';
import Typography from '@/components/ui/Typography';
import { ROUTES } from '@/lib/constants';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

interface TenantSwitcherProps {
  isCollapsed?: boolean;
}

/**
 * Enterprise Scale Tenant Switcher.
 * Allows global context switching between workspaces/teams/orgs.
 */
export default function TenantSwitcher({ isCollapsed }: TenantSwitcherProps) {
  const { activeWorkspaceId, setActiveWorkspace, workspaces, tenantInfo, isLoading } = useTenant();
  const [isOpen, setIsOpen] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // Sync state with URL if it exists
  useEffect(() => {
    const urlWsId = searchParams.get('workspaceId');
    if (urlWsId && urlWsId !== activeWorkspaceId) {
      setActiveWorkspace(urlWsId);
    }
  }, [searchParams, activeWorkspaceId, setActiveWorkspace]);

  const handleSwitch = (id: string | null) => {
    setActiveWorkspace(id);
    setIsOpen(false);

    // Update URL query param to maintain context across SSR
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set('workspaceId', id);
    } else {
      params.delete('workspaceId');
    }

    router.push(`${pathname}?${params.toString()}`);
  };

  if (isLoading && !isCollapsed) {
    return (
      <div className="px-2 mb-4 animate-pulse">
        <div className="h-10 bg-foreground/5 rounded border border-border/50" />
      </div>
    );
  }

  const activeName = tenantInfo?.name || 'Global Hive';

  return (
    <div className={`relative mb-4 group ${isCollapsed ? 'px-0' : 'px-2'}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          w-full flex items-center gap-3 rounded transition-all border
          ${isOpen ? 'bg-foreground/10 border-cyber-green/50 shadow-premium' : 'bg-foreground/5 border-border/50 hover:bg-foreground/80 hover:border-border'}
          ${isCollapsed ? 'justify-center h-10 p-0' : 'justify-between p-2'}
        `}
      >
        <div
          className={`flex items-center gap-3 overflow-hidden ${isCollapsed ? 'justify-center' : ''}`}
        >
          <div
            className={`
            shrink-0 flex items-center justify-center rounded-sm
            ${activeWorkspaceId ? 'bg-violet-500/20 text-violet-400' : 'bg-cyber-green/20 text-cyber-green'}
            ${isCollapsed ? 'w-6 h-6' : 'w-6 h-6'}
          `}
          >
            {activeWorkspaceId ? <Building2 size={14} /> : <Globe size={14} />}
          </div>

          {!isCollapsed && (
            <div className="flex flex-col items-start overflow-hidden text-left">
              <Typography
                variant="mono"
                weight="bold"
                className="text-[10px] leading-tight truncate w-full uppercase tracking-tighter"
              >
                {activeName}
              </Typography>
              <Typography
                variant="mono"
                color="muted"
                className="text-[8px] leading-tight uppercase opacity-50 font-black"
              >
                {tenantInfo?.orgId ? `ORG: ${tenantInfo.orgId}` : 'ROOT DOMAIN'}
              </Typography>
            </div>
          )}
        </div>

        {!isCollapsed && (
          <ChevronDown
            size={12}
            className={`text-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-60" onClick={() => setIsOpen(false)} />
          <div
            className={`
            absolute z-70 mt-2 bg-background border border-border shadow-premium rounded-md py-1 overflow-hidden
            ${isCollapsed ? 'left-14 top-0 w-56' : 'left-2 right-2 top-full'}
          `}
          >
            <div className="px-3 py-2 border-b border-border/50 bg-foreground/5 mb-1">
              <Typography
                variant="mono"
                weight="black"
                className="text-[9px] uppercase tracking-widest text-muted"
              >
                Switch Workspace
              </Typography>
            </div>

            <button
              onClick={() => handleSwitch(null)}
              className={`
                w-full flex items-center justify-between px-3 py-2 text-left hover:bg-foreground/5 transition-colors
                ${!activeWorkspaceId ? 'text-cyber-green' : 'text-foreground/70'}
              `}
            >
              <div className="flex items-center gap-3 overflow-hidden text-xs">
                <Globe size={14} className="shrink-0" />
                <span className="truncate uppercase font-bold tracking-tight">Global Hive</span>
              </div>
              {!activeWorkspaceId && <Check size={12} />}
            </button>

            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => handleSwitch(ws.id)}
                className={`
                  w-full flex items-center justify-between px-3 py-2 text-left hover:bg-foreground/5 transition-colors
                  ${activeWorkspaceId === ws.id ? 'text-cyber-green' : 'text-foreground/70'}
                `}
              >
                <div className="flex items-center gap-3 overflow-hidden text-xs">
                  <Building2 size={14} className="shrink-0" />
                  <span className="truncate uppercase font-bold tracking-tight">{ws.name}</span>
                </div>
                {activeWorkspaceId === ws.id && <Check size={12} />}
              </button>
            ))}

            <div className="mt-1 border-t border-border/50 pt-1">
              <Link
                href={ROUTES.WORKSPACES}
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-3 py-2 text-xs text-muted hover:text-foreground hover:bg-foreground/5 transition-all"
              >
                <Plus size={14} />
                <span className="uppercase tracking-widest text-[9px] font-black">
                  Manage Workspaces
                </span>
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
