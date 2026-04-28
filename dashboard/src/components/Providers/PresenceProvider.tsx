'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useRealtimeContext, RealtimeMessage } from './RealtimeProvider';
import { useTenant } from './TenantProvider';
import { logger } from '@claw/core/lib/logger';

interface PresenceInfo {
  memberId: string;
  displayName: string;
  type: 'human' | 'agent';
  lastSeen: number;
  status: 'online' | 'away' | 'offline';
  cursor?: { x: number; y: number };
}

interface PresenceContextType {
  members: PresenceInfo[];
  myPresence: PresenceInfo | null;
  updateStatus: (status: PresenceInfo['status']) => void;
}

const PresenceContext = createContext<PresenceContextType | undefined>(undefined);

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { subscribe, isLive, userId } = useRealtimeContext();
  const { activeWorkspaceId } = useTenant();
  const [members, setMembers] = useState<PresenceInfo[]>([]);
  const [myStatus, setMyStatus] = useState<PresenceInfo['status']>('online');
  const presenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const myPresence = React.useMemo(
    () => ({
      memberId: userId || 'unknown',
      displayName: 'Operator',
      type: 'human' as const,
      lastSeen: 0, // Will be handled by heartbeat or state if needed
      status: myStatus,
    }),
    [userId, myStatus]
  );

  useEffect(() => {
    if (!isLive || !activeWorkspaceId) return;

    // Subscribe to workspace presence signals
    const unsubscribe = subscribe(
      [`workspaces/${activeWorkspaceId}/presence`],
      (topic: string, message: RealtimeMessage) => {
        const payload = message as unknown as PresenceInfo;
        if (payload.memberId === userId) return;
        setMembers((prev) => {
          const existingIndex = prev.findIndex((m) => m.memberId === payload.memberId);
          const newMember = {
            ...payload,
            lastSeen: Date.now(),
          };

          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = newMember;
            return updated;
          }
          return [...prev, newMember];
        });
      }
    );

    // Heartbeat: Publish my presence every 30 seconds
    const sendPresence = () => {
      // In a real app, this would use mqttClientRef.current.publish
      // For this demo, we'll just log it.
      logger.info(`[Presence] Heartbeat for ${userId}`);
    };

    sendPresence();
    presenceIntervalRef.current = setInterval(sendPresence, 30000);

    // Cleanup stale members
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setMembers((prev) => prev.filter((m) => now - m.lastSeen < 60000));
    }, 15000);

    return () => {
      unsubscribe();
      if (presenceIntervalRef.current) clearInterval(presenceIntervalRef.current);
      clearInterval(cleanupInterval);
    };
  }, [isLive, activeWorkspaceId, userId, subscribe]);

  const updateStatus = useCallback((status: PresenceInfo['status']) => {
    setMyStatus(status);
  }, []);

  return (
    <PresenceContext.Provider value={{ members, myPresence, updateStatus }}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence() {
  const context = useContext(PresenceContext);
  if (context === undefined) {
    throw new Error('usePresence must be used within a PresenceProvider');
  }
  return context;
}
