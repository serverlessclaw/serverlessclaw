import { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';

export interface RealtimeMessage {
  'detail-type': string;
  detail: Record<string, unknown>;
  [key: string]: unknown;
}

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
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mqttClientRef = useRef<mqtt.MqttClient | null>(null);
  const onMessageRef = useRef(onMessage);

  // Keep callback ref updated to avoid closure traps
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const connect = async () => {
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        if (!config.realtime?.url) {
          console.warn('[Realtime] IoT URL missing in config');
          return;
        }

        // AWS IoT WebSockets require the /mqtt path
        const baseUrl = config.realtime.url.endsWith('/mqtt')
          ? config.realtime.url
          : `${config.realtime.url}/mqtt`;

        // Ensure we send an auth token expected by the IoT custom authorizer.
        // Persist a lightweight client token in localStorage when available so reconnects reuse it.
        let token: string | null = null;
        try {
          const tokenKey = 'sc_realtime_token';
          token = localStorage.getItem(tokenKey);
          if (!token) {
            token = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
            localStorage.setItem(tokenKey, token);
          }
        } catch {
          // localStorage may be unavailable in some test environments; fall back to a generated token
          token = token || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        }

        const mqttUrl = config.realtime.authorizer
          ? `${baseUrl}?x-amz-customauthorizer-name=${config.realtime.authorizer}&token=${encodeURIComponent(
              token
            )}`
          : `${baseUrl}?token=${encodeURIComponent(token)}`;

        const client = mqtt.connect(mqttUrl, {
          protocol: 'wss',
          clientId: `dashboard-${Math.random().toString(16).slice(2, 10)}`,
          clean: true,
          connectTimeout: 30000,
          reconnectPeriod: 5000,
        });

        client.on('connect', () => {
          setIsConnected(true);
          setError(null);
          console.log('[Realtime] Connected to IoT Core');

          // Default subscriptions
          const defaultTopics = [`users/${userId}/#`];
          const allTopics = Array.from(new Set([...defaultTopics, ...topics]));

          allTopics.forEach((topic) => {
            console.log(`[Realtime] Subscribing to: ${topic}`);
            client.subscribe(topic);
          });
        });

        client.on('message', (topic: string, payload: Buffer) => {
          try {
            const data = JSON.parse(payload.toString()) as RealtimeMessage;
            if (onMessageRef.current) {
              onMessageRef.current(topic, data);
            }
          } catch (e) {
            console.error('[Realtime] Failed to parse message:', e);
          }
        });

        client.on('error', (err: Error) => {
          console.error('[Realtime] MQTT Error:', err);
          setError(err);
          setIsConnected(false);
        });

        client.on('close', () => {
          setIsConnected(false);
        });

        mqttClientRef.current = client;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.error('[Realtime] Setup failed:', err);
        setError(err);
      }
    };

    connect();

    return () => {
      if (mqttClientRef.current) {
        console.log('[Realtime] Disconnecting...');
        mqttClientRef.current.end();
      }
    };
    // Only run once on mount or when topics change significantly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { isConnected, error };
}
