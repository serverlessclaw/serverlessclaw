import { useEffect, useMemo, useRef } from 'react';
import { useRealtimeContext, type RealtimeMessage } from '@/components/Providers/RealtimeProvider';
import { logger } from '@claw/core/lib/logger';

export type { RealtimeMessage };

export interface UseRealtimeOptions {
  topics?: string[];
  onMessage?: (topic: string, payload: RealtimeMessage) => void;
  userId?: string;
  workspaceId?: string;
}

/**
 * Clean & Simple hook for AWS IoT Core MQTT connectivity.
 */
export function useRealtime({
  topics = [],
  onMessage,
  userId: userIdOption,
  workspaceId,
}: UseRealtimeOptions = {}) {
  const {
    isConnected,
    error,
    userId: contextUserId,
    subscribe,
    sessions,
    pendingMessages,
    fetchSessions,
  } = useRealtimeContext();

  const userId = userIdOption || contextUserId || 'dashboard-user';
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const allTopics = useMemo(() => {
    const defaultTopics = [`users/${userId}/#`];
    if (workspaceId) {
      defaultTopics.push(`workspaces/${workspaceId}/#`);
      defaultTopics.push(`workspaces/${workspaceId}/sessions/#`);
    }
    return Array.from(new Set([...defaultTopics, ...topics])).sort();
  }, [topics, userId, workspaceId]);

  useEffect(() => {
    if (!onMessageRef.current) return;
    logger.info(`[useRealtime] Subscribing to: ${allTopics.join(', ')}`);
    const unsubscribe = subscribe(allTopics, (topic, data) => onMessageRef.current?.(topic, data));
    return () => {
      logger.info(`[useRealtime] Unsubscribing from topics...`);
      unsubscribe();
    };
  }, [allTopics, subscribe]);

  return { isConnected, error, sessions, pendingMessages, fetchSessions, isLive: isConnected };
}
