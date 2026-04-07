'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { toast } from 'sonner';

interface UICommandDetail {
  action: 'open_modal' | 'close_modal' | 'focus_resource' | 'toggle_sidebar';
  target: string;
  payload?: {
    collapsed?: boolean;
    [key: string]: unknown;
  };
}

interface UICommandContextType {
  activeModal: string | null;
  setActiveModal: (id: string | null) => void;
  isSidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  lastCommand: UICommandDetail | null;
}

const UICommandContext = createContext<UICommandContextType | undefined>(undefined);

/**
 * Provider that listens for global 'claw:ui-command' events and manages UI state.
 * This acts as the "Brain" for agent-driven UI actions.
 */
export function UICommandProvider({ children }: { children: React.ReactNode }) {
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [isSidebarCollapsed, setSidebarCollapsedState] = useState(false);
  const [lastCommand, setLastCommand] = useState<UICommandDetail | null>(null);

  // Load initial state from localStorage on client-side mount
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    if (saved === 'true') {
      const timer = setTimeout(() => setSidebarCollapsedState(true), 0);
      return () => clearTimeout(timer);
    }
  }, []);

  const setSidebarCollapsed = (collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    localStorage.setItem('sidebar_collapsed', String(collapsed));
  };

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const customEvent = event as CustomEvent<UICommandDetail>;
      const detail = customEvent.detail;
      
      if (!detail || !detail.action) return;
      
      setLastCommand(detail);
      console.log(`[UICommandProvider] Executing agent command:`, detail);

      switch (detail.action) {
        case 'open_modal':
          setActiveModal(detail.target);
          break;
        case 'close_modal':
          setActiveModal((current) => (current === detail.target ? null : current));
          break;
        case 'focus_resource':
          toast(`Focusing resource: ${detail.target}`);
          break;
        case 'toggle_sidebar':
          if (detail.payload && typeof detail.payload.collapsed === 'boolean') {
            setSidebarCollapsed(detail.payload.collapsed);
          } else {
            setSidebarCollapsed(!isSidebarCollapsed);
          }
          break;
      }
    };

    window.addEventListener('claw:ui-command', handleCommand);
    return () => window.removeEventListener('claw:ui-command', handleCommand);
  }, [isSidebarCollapsed]);

  return (
    <UICommandContext.Provider 
      value={{ 
        activeModal, 
        setActiveModal, 
        isSidebarCollapsed, 
        setSidebarCollapsed, 
        lastCommand 
      }}
    >
      {children}
    </UICommandContext.Provider>
  );
}

export const useUICommand = () => {
  const context = useContext(UICommandContext);
  if (!context) throw new Error('useUICommand must be used within a UICommandProvider');
  return context;
};
