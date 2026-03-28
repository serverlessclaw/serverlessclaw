import { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { ChatMessage } from './types';
import type { ConversationMeta } from '@claw/core/lib/types/memory';
import { shouldProcessChunk, applyChunkToMessages, mergeHistoryWithMessages } from './message-handler';

export function useChatConnection(activeSessionId: string, setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>, setIsLoading: React.Dispatch<React.SetStateAction<boolean>>, isPostInFlight: React.MutableRefObject<boolean>) {
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);
  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
  const mqttClientRef = useRef<mqtt.MqttClient | null>(null);
  const activeSessionRef = useRef<string>(activeSessionId);
  const skipNextHistoryFetch = useRef<boolean>(false);
  const seenMessageIds = useRef<Set<string>>(new Set());

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

  const fetchHistorySilently = async (sessionId: string) => {
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
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    const userId = 'dashboard-user';
    const connect = async () => {
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        if (!config.realtime?.url) return;

        // AWS IoT WebSockets require the /mqtt path
        const baseUrl = config.realtime.url.endsWith('/mqtt') 
          ? config.realtime.url 
          : `${config.realtime.url}/mqtt`;

        // Append authorizer name to the URL if provided
        const mqttUrl = config.realtime.authorizer 
          ? `${baseUrl}?x-amz-customauthorizer-name=${config.realtime.authorizer}`
          : baseUrl;

        const client = mqtt.connect(mqttUrl, {
          protocol: 'wss',
          clientId: `dashboard-${Math.random().toString(16).slice(2, 10)}`,
          username: 'dashboardUser',
          password: 'auth-token',
          clean: true,
          connectTimeout: 30000,
          reconnectPeriod: 5000,
        });

        client.on('connect', () => {
          setIsRealtimeActive(true);
          // Subscribe to ALL signals for this user using a wildcard
          // This covers both generic user signals and session-specific signals
          const userTopicWildcard = `users/${userId}/#`;
          client.subscribe(userTopicWildcard);
        });

        client.on('message', (t: string, payload: unknown) => {
          try {
            const data = JSON.parse(String(payload));
            const currentActiveId = activeSessionRef.current;
            
            if (shouldProcessChunk(data, currentActiveId, userId)) {
              setMessages(prev => applyChunkToMessages(prev, data, seenMessageIds.current));
            } else {
              if (currentActiveId && !isPostInFlight.current) {
                fetchHistorySilently(currentActiveId);
              }
            }
          } catch (e) {
            console.error('[Realtime] Failed to parse message:', e);
          }
        });

        client.on('error', (err: unknown) => {
          console.error('[Realtime] MQTT Error:', err);
          setIsRealtimeActive(false);
        });

        client.on('close', () => {
          setIsRealtimeActive(false);
        });
        mqttClientRef.current = client;
      } catch (e) {
        console.error('[Realtime] Setup failed:', e);
      }
    };

    connect();
    return () => {
      if (mqttClientRef.current) {
        mqttClientRef.current.end();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, isRealtimeActive]);

  return { isRealtimeActive, sessions, fetchSessions, skipNextHistoryFetch, seenMessageIds };
}
