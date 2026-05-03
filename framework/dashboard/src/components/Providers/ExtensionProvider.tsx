'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

export interface SidebarExtension {
  id: string;
  label: string;
  subtitle?: string;
  href: string;
  icon: LucideIcon;
  section?: string; // e.g., 'OPERATIONS', 'INTELLIGENCE'
}

export interface DynamicComponentExtension {
  type: string;
  component: React.ComponentType<{
    component: any;
    onAction?: (actionId: string, payload?: unknown) => void;
  }>;
}

interface ExtensionContextType {
  sidebarExtensions: SidebarExtension[];
  dynamicComponents: Map<string, DynamicComponentExtension['component']>;
  registerSidebarExtension: (extension: SidebarExtension) => void;
  registerDynamicComponent: (extension: DynamicComponentExtension) => void;
}

const ExtensionContext = createContext<ExtensionContextType | undefined>(undefined);

/**
 * ExtensionProvider allows domain-specific applications (like VoltX) to inject
 * custom UI elements into the base ServerlessClaw dashboard.
 */
export function ExtensionProvider({ children }: { children: ReactNode }) {
  const [sidebarExtensions, setSidebarExtensions] = useState<SidebarExtension[]>([]);
  const [dynamicComponents] = useState<Map<string, DynamicComponentExtension['component']>>(new Map());

  const registerSidebarExtension = (extension: SidebarExtension) => {
    setSidebarExtensions((prev) => {
      if (prev.find((e) => e.id === extension.id)) return prev;
      return [...prev, extension];
    });
  };

  const registerDynamicComponent = (extension: DynamicComponentExtension) => {
    dynamicComponents.set(extension.type, extension.component);
  };

  return (
    <ExtensionContext.Provider
      value={{
        sidebarExtensions,
        dynamicComponents,
        registerSidebarExtension,
        registerDynamicComponent,
      }}
    >
      {children}
    </ExtensionContext.Provider>
  );
}

export function useExtensions() {
  const context = useContext(ExtensionContext);
  if (!context) {
    throw new Error('useExtensions must be used within an ExtensionProvider');
  }
  return context;
}
