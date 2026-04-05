'use client';

import { useEffect } from 'react';
import { usePageContext } from '@/components/Providers/PageContextProvider';

interface TraceContextRegistrarProps {
  traceId: string;
  url: string;
  data?: unknown;
}

/**
 * Client component to register trace-specific context for the global chat bubble.
 */
export default function TraceContextRegistrar({ traceId, url, data }: TraceContextRegistrarProps) {
  const { setPageContext, clearPageContext } = usePageContext();

  useEffect(() => {
    setPageContext({
      traceId,
      url,
      title: `Trace ${traceId.slice(0, 8)}`,
      data: data as Record<string, unknown>,
    });

    return () => clearPageContext();
  }, [traceId, url, data, setPageContext, clearPageContext]);

  return null;
}
