'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';

export interface TenantInfo {
  id: string;
  name: string;
  orgId?: string;
  teamId?: string;
}

export interface TenantContextType {
  activeWorkspaceId: string | null;
  activeOrgId: string | null;
  activeTeamId: string | null;
  setActiveWorkspace: (id: string | null) => void;
  tenantInfo: TenantInfo | null;
  workspaces: TenantInfo[];
  isLoading: boolean;
  refreshWorkspaces: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

/**
 * Provider for managing global tenant context (Workspace/Org/Team).
 * Enables Enterprise Scale isolation across the dashboard.
 */
export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<TenantInfo[]>([]);
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch('/api/workspaces');
      const data = await res.json();
      setWorkspaces(data.workspaces || []);
    } catch (e) {
      console.error('Failed to fetch workspaces:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load selection and fetch list on mount
  useEffect(() => {
    const saved = localStorage.getItem('claw_active_workspace');
    if (saved) {
      setActiveWorkspaceId(saved);
    }
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const setActiveWorkspace = useCallback((id: string | null) => {
    setActiveWorkspaceId(id);
    if (id) {
      localStorage.setItem('claw_active_workspace', id);
    } else {
      localStorage.removeItem('claw_active_workspace');
    }
  }, []);

  // Update detailed tenant info when selection or list changes
  useEffect(() => {
    if (activeWorkspaceId && workspaces.length > 0) {
      const info = workspaces.find((w) => w.id === activeWorkspaceId);
      setTenantInfo(info || null);
    } else {
      setTenantInfo(null);
    }
  }, [activeWorkspaceId, workspaces]);

  const value = useMemo(
    () => ({
      activeWorkspaceId,
      activeOrgId: tenantInfo?.orgId || null,
      activeTeamId: tenantInfo?.teamId || null,
      setActiveWorkspace,
      tenantInfo,
      workspaces,
      isLoading,
      refreshWorkspaces: fetchWorkspaces,
    }),
    [activeWorkspaceId, tenantInfo, workspaces, isLoading, setActiveWorkspace, fetchWorkspaces]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

/**
 * Hook to access and manage the current tenant context.
 */
export function useTenant() {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
}
