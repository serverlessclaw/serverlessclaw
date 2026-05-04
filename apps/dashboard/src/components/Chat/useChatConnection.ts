import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChatMessage } from '@claw/hooks';
import { logger } from '@claw/core/lib/logger';
import {
  shouldProcessChunk,
  applyChunkToMessages,
  mergeHistoryWithMessages,
  type IncomingChunk,
} from '@claw/hooks';
import { useRealtime, RealtimeMessage } from '@/hooks/useRealtime';
import type { PendingMessage } from '@claw/core/lib/types/session';

export function useChatConnection(
  activeSessionId: string,
  setMessagesRef: React.MutableRefObject<React.Dispatch<React.SetStateAction<ChatMessage[]>>>,
  _setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  isPostInFlight: React.MutableRefObject<boolean>,
  workspaceId: string | null = null,
  disabled = false
) {
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const activeSessionRef = useRef<string>(activeSessionId);
  const skipNextHistoryFetch = useRef<boolean>(false);
  const seenMessageIds = useRef<Set<string>>(new Set());
  const lastFetchedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  const fetchHistorySilently = useCallback(
    async (sessionId: string) => {
      if (isPostInFlight.current || sessionId === lastFetchedSessionRef.current) return;
      try {
        const url = new URL('/api/chat', window.location.origin);
        url.searchParams.set('sessionId', sessionId);
        if (workspaceId) url.searchParams.set('workspaceId', workspaceId);

        const response = await fetch(url.toString());
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          return;
        }
        const data = await response.json();
        if (data.history) {
          lastFetchedSessionRef.current = sessionId;
          setMessagesRef.current((prev) => {
            const { messages, seenIds } = mergeHistoryWithMessages(prev, data.history);
            seenMessageIds.current = seenIds;
            return messages;
          });
        }
      } catch (e) {
        logger.warn('Silent History fetch failed:', e);
      }
    },
    [isPostInFlight, setMessagesRef, workspaceId]
  );

  const fetchPendingSilently = useCallback(
    async (sessionId: string) => {
      if (isPostInFlight.current) return;
      try {
        const url = new URL('/api/pending-messages', window.location.origin);
        url.searchParams.set('sessionId', sessionId);
        if (workspaceId) url.searchParams.set('workspaceId', workspaceId);

        const res = await fetch(url.toString());
        if (res.ok) {
          const data = await res.json();
          setPendingMessages(data.pendingMessages ?? []);
        }
      } catch {
        // Silently ignore
      }
    },
    [isPostInFlight, workspaceId]
  );

  const handleMessage = useCallback(
    (topic: string, data: RealtimeMessage) => {
      const currentActiveId = activeSessionRef.current;

      const normalized: IncomingChunk & { 'detail-type'?: string } = {
        ...(typeof data.detail === 'object' && data.detail !== null ? data.detail : {}),
        ...(data as Record<string, unknown>),
      };

      if (shouldProcessChunk(normalized, currentActiveId, 'dashboard-user')) {
        logger.info(
          `[SIGNAL] ✅ Processing chunk: ${normalized.messageId} (msg: ${normalized.message?.length ?? 0} chars)`
        );
        setMessagesRef.current((prev) =>
          applyChunkToMessages(prev, normalized, seenMessageIds.current)
        );
      } else {
        logger.warn(
          `[SIGNAL] ⚠️ Chunk ignored (filter): ${normalized.messageId} on topic ${topic}`
        );
        if (currentActiveId && !isPostInFlight.current) {
          fetchHistorySilently(currentActiveId);
        }
      }
    },
    [fetchHistorySilently, isPostInFlight, setMessagesRef]
  );

  const {
    sessions,
    fetchSessions,
    isLive: isRealtimeActive,
  } = useRealtime({
    topics: useMemo(
      () =>
        workspaceId
          ? [`workspaces/${workspaceId}/signal`, `users/+/signal`]
          : ['users/+/signal', 'users/+/sessions/+/signal'],
      [workspaceId]
    ),
    onMessage: handleMessage,
    workspaceId: workspaceId || 'default',
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSyncRef = useRef<number>(0);

  useEffect(() => {
    if (!activeSessionId || disabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (!intervalRef.current) {
      // Initialize with a past timestamp so first check fires after a 2s delay
      lastSyncRef.current = Date.now() - 60000;
      const runSync = () => {
        const now = Date.now();
        const sessionId = activeSessionRef.current;
        if (!sessionId) return;

        const freq = 60000; // Increased to 60s
        if (now - lastSyncRef.current < freq) return;

        if (!document.hidden && !isPostInFlight.current) {
          lastSyncRef.current = now;
          fetchHistorySilently(sessionId);
          fetchPendingSilently(sessionId);
        }
      };
      intervalRef.current = setInterval(runSync, 2000);
    }
  }, [activeSessionId, disabled, fetchHistorySilently, fetchPendingSilently, isPostInFlight]);

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
