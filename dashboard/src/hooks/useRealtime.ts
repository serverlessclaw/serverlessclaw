import { useEffect, useRef } from 'react';
import { RealtimeMessage, useRealtimeContext } from '@/components/Providers/RealtimeProvider';

export type { RealtimeMessage };

export interface UseRealtimeOptions {
  topics?: string[];
  onMessage?: (topic: string, payload: RealtimeMessage) => void;
  userId?: string;
}

/**
 * Shared hook for AWS IoT Core MQTT connectivity.
 * Refactored to use a shared connection via RealtimeProvider.
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

  useEffect(() => {
    const handleMessage = (topic: string, payload: RealtimeMessage) => {
      if (onMessageRef.current) {
        onMessageRef.current(topic, payload);
      }
    };

    // Include the default subscription for this user
    const defaultTopics = [`users/${userId}/#`];
    const allTopics = Array.from(new Set([...defaultTopics, ...topics])).sort();

    const unsubscribe = subscribe(allTopics, handleMessage);

    return () => {
      unsubscribe();
    };
  }, [subscribe, topics.join(','), userId]);

  return { isConnected, error };
}
