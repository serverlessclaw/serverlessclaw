import { useState, useEffect, useRef, useCallback } from 'react';
import { ChatMessage } from './types';
import type { ConversationMeta } from '@claw/core/lib/types/memory';
import {
  shouldProcessChunk,
  applyChunkToMessages,
  mergeHistoryWithMessages,
  type IncomingChunk,
} from './message-handler';
import { useRealtime, RealtimeMessage } from '@/hooks/useRealtime';

export function useChatConnection(activeSessionId: string, setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>, setIsLoading: React.Dispatch<React.SetStateAction<boolean>>, isPostInFlight: React.MutableRefObject<boolean>) {
  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
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

  const fetchHistorySilently = useCallback(async (sessionId: string) => {
    if (isPostInFlight.current) return;
    try {
      const response = await fetch(`/api/chat?sessionId=${sessionId}`);
      const data = await response.json();
      if (data.history) {
        setMessages(prev => {
          const { messages, seenIds } = mergeHistoryWithMessages(prev, data.history);
          seenMessageIds.current = seenIds;
          return messages;
        });
      }
    } catch (e) {
      console.warn('Silent History fetch failed:', e);
    }
  }, [isPostInFlight, setMessages]);

  const handleMessage = useCallback((_topic: string, data: RealtimeMessage) => {
    const currentActiveId = activeSessionRef.current;
    const normalized: IncomingChunk & { 'detail-type'?: string } = {
      ...(typeof data.detail === 'object' && data.detail !== null ? data.detail : {}),
      ...(data as Record<string, unknown>),
    };
    
    if (shouldProcessChunk(normalized, currentActiveId, userId)) {
      setMessages(prev => applyChunkToMessages(prev, normalized, seenMessageIds.current));
    } else {
      // If we got a signal for the active session but it's not a chunk (e.g., status update),
      // refresh history to get the latest state.
      if (currentActiveId && !isPostInFlight.current) {
        fetchHistorySilently(currentActiveId);
      }
    }
  }, [fetchHistorySilently, isPostInFlight, setMessages]);

  const { isConnected: isRealtimeActive } = useRealtime({
    topics: ['collaborations/+/signal', 'workspaces/+/signal'],
    onMessage: handleMessage,
    userId
  });

  useEffect(() => {
    const init = async () => {
      await fetchSessions();
    };
    init();
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    const interval = setInterval(() => {
      const isIdle = !document.hidden;
      if (isIdle && !isPostInFlight.current) {
        fetchHistorySilently(activeSessionId);
      }
    }, isRealtimeActive ? 60000 : 10000);
    return () => clearInterval(interval);
  }, [activeSessionId, isRealtimeActive, isPostInFlight, fetchHistorySilently]);

  return { isRealtimeActive, sessions, fetchSessions, skipNextHistoryFetch, seenMessageIds };
}
