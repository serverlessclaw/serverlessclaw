'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { PageContextData } from '../../types/page-context';

interface PageContextType {
  context: PageContextData | null;
  setPageContext: (data: Partial<PageContextData>) => void;
  clearPageContext: () => void;
}

const PageContext = createContext<PageContextType | undefined>(undefined);

/**
 * Provider for managing global page context that can be attached to chat messages.
 */
export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<PageContextData | null>(null);

  const setPageContext = useCallback((data: Partial<PageContextData>) => {
    setContext((prev) => ({
      url: typeof window !== 'undefined' ? window.location.pathname : '',
      title: typeof document !== 'undefined' ? document.title : '',
      ...prev,
      ...data,
    }));
  }, []);

  const clearPageContext = useCallback(() => {
    setContext(null);
  }, []);

  const value = useMemo(
    () => ({
      context,
      setPageContext,
      clearPageContext,
    }),
    [context, setPageContext, clearPageContext]
  );

  return <PageContext.Provider value={value}>{children}</PageContext.Provider>;
}

/**
 * Hook to access and update the current page context.
 */
export function usePageContext() {
  const context = useContext(PageContext);
  if (context === undefined) {
    throw new Error('usePageContext must be used within a PageContextProvider');
  }
  return context;
}
