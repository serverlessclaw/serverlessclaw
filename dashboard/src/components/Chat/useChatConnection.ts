import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChatMessage } from './types';
import type { ConversationMeta } from '@claw/core/lib/types/memory';
import {
  shouldProcessChunk,
  applyChunkToMessages,
  mergeHistoryWithMessages,
  type IncomingChunk,
} from './message-handler';
import { useRealtime, RealtimeMessage } from '@/hooks/useRealtime';
import type { PendingMessage } from '@claw/core/lib/types/session';

export function useChatConnection(
  activeSessionId: string,
  setMessagesRef: React.MutableRefObject<React.Dispatch<React.SetStateAction<ChatMessage[]>>>,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  isPostInFlight: React.MutableRefObject<boolean>
) {
  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const activeSessionRef = useRef<string>(activeSessionId);
  const skipNextHistoryFetch = useRef<boolean>(false);
  const seenMessageIds = useRef<Set<string>>(new Set());
  const userId = 'dashboard-user';

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  const fetchSessions = async () => {
    try {
      const response = await fetch('/api/chat');
      const data = await response.json();
      if (data.sessions) {
        setSessions(data.sessions);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    }
  };

  const fetchHistorySilently = useCallback(
    async (sessionId: string) => {
      if (isPostInFlight.current) return;
      try {
        const response = await fetch(`/api/chat?sessionId=${sessionId}`);
        const data = await response.json();
          if (data.history) {
             
            setMessagesRef.current((prev) => {
              const { messages, seenIds } = mergeHistoryWithMessages(prev, data.history);
            seenMessageIds.current = seenIds;
            return messages;
          });
        }
      } catch (e) {
        console.warn('Silent History fetch failed:', e);
      }
    },
    [isPostInFlight, setMessagesRef]
  );

  const fetchPendingSilently = useCallback(
    async (sessionId: string) => {
      if (isPostInFlight.current) return;
      try {
        const res = await fetch(`/api/pending-messages?sessionId=${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          setPendingMessages(data.pendingMessages ?? []);
        }
      } catch {
        // Silently ignore
      }
    },
    [isPostInFlight]
  );

  const handleMessage = useCallback(
    (_topic: string, data: RealtimeMessage) => {
      const currentActiveId = activeSessionRef.current;
      const normalized: IncomingChunk & { 'detail-type'?: string } = {
        ...(typeof data.detail === 'object' && data.detail !== null ? data.detail : {}),
        ...(data as Record<string, unknown>),
      };

      if (shouldProcessChunk(normalized, currentActiveId, userId)) {
        setMessagesRef.current((prev) => applyChunkToMessages(prev, normalized, seenMessageIds.current));
      } else {
        // If we got a signal for the active session but it's not a chunk (e.g., status update),
        // refresh history to get the latest state.
        if (currentActiveId && !isPostInFlight.current) {
          fetchHistorySilently(currentActiveId);
        }
      }
    },
    [fetchHistorySilently, isPostInFlight, setMessagesRef]
  );

  const topics = useMemo(
    () => [
      'users/+/signal',
      'users/+/sessions/+/signal',
      'collaborations/+/signal',
      'workspaces/+/signal',
    ],
    []
  );

  const { isConnected: isRealtimeActive } = useRealtime({
    topics,
    onMessage: handleMessage,
    userId,
  });

  useEffect(() => {
    const init = async () => {
      await fetchSessions();
    };
    init();
  }, []);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSyncRef = useRef<number>(0);
  const isRealtimeActiveRef = useRef<boolean>(false);

  // Keep refs in sync with state for use in the static interval
  useEffect(() => {
    isRealtimeActiveRef.current = isRealtimeActive;
  }, [isRealtimeActive]);

  useEffect(() => {
    if (!activeSessionId) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (pendingMessages.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPendingMessages([]);
      }
      return;
    }

    // Start interval if not already running
    if (!intervalRef.current) {
      const runSync = () => {
        const now = Date.now();
        const sessionId = activeSessionRef.current;
        const isLive = isRealtimeActiveRef.current;
        
        if (!sessionId) return;
        if (now - lastSyncRef.current < 5000) return; // 5s absolute throttle
        
        // Frequency check (10s offline, 60s online)
        const freq = isLive ? 60000 : 10000;
        if (now - lastSyncRef.current < freq) return;

        const isIdle = !document.hidden;
        if (isIdle && !isPostInFlight.current) {
          lastSyncRef.current = now;
          fetchHistorySilently(sessionId);
          fetchPendingSilently(sessionId);
        }
      };

      // Run every 2 seconds to check the state, but internal throttles enforce the 10s/60s rhythm
      intervalRef.current = setInterval(runSync, 2000);
    }

    return () => {
      // We only clear on unmount or activeSessionId becoming empty
    };
  }, [activeSessionId, fetchHistorySilently, fetchPendingSilently, isPostInFlight, pendingMessages.length]);

  // Global cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return {
    isRealtimeActive,
    sessions,
    pendingMessages,
    setPendingMessages,
    fetchPendingSilently,
    fetchSessions,
    skipNextHistoryFetch,
    seenMessageIds,
  };
}
