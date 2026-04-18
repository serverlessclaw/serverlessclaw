'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import mqtt from 'mqtt';
import type { ConversationMeta } from '@claw/core/lib/types/memory';
import type { PendingMessage } from '@claw/core/lib/types/session';

export interface RealtimeMessage {
  'detail-type': string;
  detail: Record<string, unknown>;
  [key: string]: unknown;
}

type MessageCallback = (topic: string, payload: RealtimeMessage) => void;

interface Subscription {
  topics: string[];
  callback: MessageCallback;
}

interface DashboardConfig {
  app: string;
  stage: string;
  realtime: {
    url: string | null;
    authorizer?: string;
  };
}

interface RealtimeContextType {
  isConnected: boolean;
  error: Error | null;
  userId: string | null;
  subscribe: (topics: string[], callback: MessageCallback) => () => void;
  sessions: ConversationMeta[];
  pendingMessages: PendingMessage[];
  setPendingMessages: React.Dispatch<React.SetStateAction<PendingMessage[]>>;
  fetchSessions: () => Promise<void>;
  isLive: boolean;
}

const RealtimeContext = createContext<RealtimeContextType | null>(null);

export function useRealtimeContext() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtimeContext must be used within a RealtimeProvider');
  }
  return context;
}

const STABLE_USER_ID = 'dashboard-user';

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [sessions, setSessions] = useState<ConversationMeta[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);

  const mqttClientRef = useRef<mqtt.MqttClient | null>(null);
  const isUnmountedRef = useRef<boolean>(false);
  const subscriptionsRef = useRef<Set<Subscription>>(new Set());
  const configCacheRef = useRef<DashboardConfig | null>(null);
  const prefixRef = useRef<string>('');

  const fetchSessions = useCallback(async () => {
    if (isUnmountedRef.current) return;
    try {
      const res = await fetch('/api/chat');
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.warn('[Realtime] Failed to fetch sessions', err);
    }
  }, []);

  const connect = useCallback(async () => {
    if (mqttClientRef.current || isUnmountedRef.current) return;

    try {
      if (!configCacheRef.current) {
        const res = await fetch('/api/config');
        if (isUnmountedRef.current) return;
        configCacheRef.current = (await res.json()) as DashboardConfig;
      }
      
      const config = configCacheRef.current;
      if (!config) return;

      prefixRef.current = `${config.app}/${config.stage}/`;

      if (!config.realtime?.url || isUnmountedRef.current || mqttClientRef.current) return;

      const clientId = `dash_${Math.random().toString(36).substring(2, 10)}`;
      const token = 'dashboard-dev-token-elegant'; 
      
      // AWS IoT Core standard WebSocket URL with custom authorizer
      const host = config.realtime.url.replace(/^wss?:\/\//, '').replace(/\/mqtt$/, '');
      const mqttUrl = `wss://${host}/mqtt?x-amz-customauthorizer-name=${config.realtime.authorizer}&x-amz-customauthorizer-token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`;

      console.log(`[Realtime] ⚡ Connecting to: wss://${host}/mqtt`);
      
      const client = mqtt.connect(mqttUrl, {
        clientId,
        protocol: 'wss',
        protocolVersion: 4, 
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 30000,
      });

      client.on('connect', () => {
        console.log('[Realtime] ✅ Connected');
        setIsConnected(true);
        setError(null);
        
        // Restore existing subscriptions
        subscriptionsRef.current.forEach(sub => {
          const prefixed = sub.topics.map(t => `${prefixRef.current}${t}`);
          console.log(`[Realtime] Restoring subscription to: ${prefixed.join(', ')}`);
          client.subscribe(prefixed);
        });
      });

      client.on('reconnect', () => console.log('[Realtime] 🔄 Reconnecting...'));
      client.on('offline', () => console.warn('[Realtime] 🔌 Client went offline'));
      client.on('message', (topic, payload) => {
        try {
          const payloadStr = payload.toString();
          console.log(`[Realtime:MQTT] Received on ${topic}: ${payloadStr.substring(0, 200)}${payloadStr.length > 200 ? '...' : ''}`);
          
          const data = JSON.parse(payloadStr) as RealtimeMessage;
          const displayTopic = topic.startsWith(prefixRef.current)
            ? topic.slice(prefixRef.current.length)
            : topic;

          let matchCount = 0;
          subscriptionsRef.current.forEach(sub => {
            const matches = sub.topics.some(t => {
              // 1. Exact match
              if (t === displayTopic) return true;
              
              // 2. MQTT Wildcard matching
              const pattern = t
                .replace(/\//g, '\\/') // Escape slashes
                .replace(/\+/g, '[^\\/]+') // '+' matches one level
                .replace(/#/g, '.*'); // '#' matches everything after
              
              const regex = new RegExp(`^${pattern}$`);
              return regex.test(displayTopic);
            });
            if (matches) {
              matchCount++;
              sub.callback(displayTopic, data);
            }
          });
          
          if (matchCount === 0) {
            console.warn(`[Realtime:MQTT] No subscription matched for topic: ${displayTopic}`);
          } else {
            console.log(`[Realtime:MQTT] Dispatched to ${matchCount} subscribers`);
          }
        } catch (e) {
          console.error('[Realtime:MQTT] Failed to parse message', e);
        }
      });

      client.on('error', (err) => {
        console.error('[Realtime] 🚫 Error:', err.message);
        setError(err);
      });

      client.on('close', () => setIsConnected(false));

      mqttClientRef.current = client;
    } catch (e) {
      console.error('[Realtime] Setup failed', e);
    }
  }, []);

  useEffect(() => {
    isUnmountedRef.current = false;
    connect();
    fetchSessions();
    const interval = setInterval(fetchSessions, 30000);
    return () => {
      isUnmountedRef.current = true;
      clearInterval(interval);
      if (mqttClientRef.current) {
        mqttClientRef.current.end(true);
        mqttClientRef.current = null;
      }
    };
  }, [connect, fetchSessions]);

  const subscribe = useCallback((topics: string[], callback: MessageCallback) => {
    const sub = { topics, callback };
    subscriptionsRef.current.add(sub);
    
    if (mqttClientRef.current?.connected) {
      const prefixed = topics.map(t => `${prefixRef.current}${t}`);
      console.log(`[Realtime] Subscribing to NEW topics: ${prefixed.join(', ')}`);
      mqttClientRef.current.subscribe(prefixed);
    }

    return () => {
      console.log(`[Realtime] Removing subscription for topics: ${topics.join(', ')}`);
      subscriptionsRef.current.delete(sub);
    };
  }, []);

  return (
    <RealtimeContext.Provider value={{ 
      isConnected, 
      error, 
      userId: STABLE_USER_ID, 
      subscribe,
      sessions,
      pendingMessages,
      setPendingMessages,
      fetchSessions,
      isLive: isConnected
    }}>
      {children}
    </RealtimeContext.Provider>
  );
}
