import { useEffect, useMemo, useRef } from 'react';
import { useRealtimeContext, type RealtimeMessage } from '@/components/Providers/RealtimeProvider';

export type { RealtimeMessage };

export interface UseRealtimeOptions {
  topics?: string[];
  onMessage?: (topic: string, payload: RealtimeMessage) => void;
  userId?: string;
}

/**
 * Shared hook for AWS IoT Core MQTT connectivity.
 * Used by Chat, Collaboration Canvas, and Resilience Gauge.
 */
export function useRealtime({
  topics = [],
  onMessage,
  userId = 'dashboard-user',
}: UseRealtimeOptions = {}) {
  const { isConnected, error, subscribe } = useRealtimeContext();
  const onMessageRef = useRef(onMessage);

  // Keep callback ref updated to avoid closure traps
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const allTopics = useMemo(() => {
    const defaultTopics = [`users/${userId}/#`];
    return Array.from(new Set([...defaultTopics, ...topics])).sort();
  }, [topics, userId]);

  useEffect(() => {
    if (!onMessageRef.current) return;

    const callbackWrapper = (topic: string, payload: RealtimeMessage) => {
      onMessageRef.current?.(topic, payload);
    };

    const unsubscribe = subscribe(allTopics, callbackWrapper);

    return () => {
      unsubscribe();
    };
  }, [allTopics, subscribe]);

  return { isConnected, error };
}
