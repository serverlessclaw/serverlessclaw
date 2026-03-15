import { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { ChatMessage, ConversationMeta, HistoryMessage } from './types';

export function useChatConnection(activeSessionId: string, setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>, setIsLoading: React.Dispatch<React.SetStateAction<boolean>>) {
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);
  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
  const mqttClientRef = useRef<any>(null);
  const activeSessionRef = useRef<string>(activeSessionId);
  const skipNextHistoryFetch = useRef<boolean>(false);

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
    try {
      const response = await fetch(`/api/chat?sessionId=${sessionId}`);
      const data = await response.json();
      if (data.history) {
        setMessages(data.history.map((m: HistoryMessage) => ({
          role: m.role === 'assistant' || m.role === 'system' ? 'assistant' : 'user',
          content: m.content,
          agentName: m.agentName || (m.role === 'assistant' || m.role === 'system' ? 'SuperClaw' : undefined),
          attachments: m.attachments,
        })).filter((m: ChatMessage) => m.content || (m.attachments && m.attachments.length > 0)));
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

        console.log('[Realtime] Connecting with MQTT...');
        const client = mqtt.connect(config.realtime.url, {
          protocol: 'wss',
          clientId: `dashboard-${Math.random().toString(16).slice(2, 10)}`,
          password: 'auth-token',
          clean: true,
          connectTimeout: 10000,
          reconnectPeriod: 5000,
        });
        
        client.on('connect', () => {
          console.log('[Realtime] Connected to push bus');
          setIsRealtimeActive(true);
          const userTopic = `users/${userId}/signal`;
          client.subscribe(userTopic);
        });

        client.on('message', (t: string, payload: any) => {
          try {
            const data = JSON.parse(payload.toString());
            const currentActiveId = activeSessionRef.current;
            if (!data.sessionId || data.sessionId === currentActiveId) {
              if (data.message && data.userId === userId) {
                setMessages(prev => {
                  const alreadyExists = prev.some(m => m.content === data.message && m.role === 'assistant');
                  if (alreadyExists) return prev;
                  return [...prev, {
                    role: 'assistant',
                    content: data.message,
                    agentName: data.agentName || 'SuperClaw'
                  }];
                });
              } else if (currentActiveId) {
                fetchHistorySilently(currentActiveId);
              }
            }
          } catch (e) {
            console.error('[Realtime] Failed to parse message:', e);
          }
        });

        client.on('error', (err: any) => {
          console.error('[Realtime] MQTT Error:', err);
          setIsRealtimeActive(false);
        });

        client.on('close', () => setIsRealtimeActive(false));
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
  }, []);

  useEffect(() => {
    const client = mqttClientRef.current;
    if (!client || !client.connected) return;
    const userId = 'dashboard-user';
    const topic = `users/${userId}/sessions/${activeSessionId}/signal`;
    if (activeSessionId) {
      client.subscribe(topic);
    }
    return () => {
      if (activeSessionId) {
        client.unsubscribe(topic);
      }
    };
  }, [activeSessionId, isRealtimeActive]);

  useEffect(() => {
    if (!activeSessionId) return;
    const interval = setInterval(() => {
      const isIdle = !document.hidden;
      if (isIdle) {
        fetchHistorySilently(activeSessionId);
      }
    }, isRealtimeActive ? 60000 : 10000);
    return () => clearInterval(interval);
  }, [activeSessionId, isRealtimeActive]);

  return { isRealtimeActive, sessions, fetchSessions, skipNextHistoryFetch };
}
