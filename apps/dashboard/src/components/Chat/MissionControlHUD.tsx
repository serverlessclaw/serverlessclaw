'use client';

import React, { useState, useEffect } from 'react';
import {
  Activity,
  Wallet,
  Zap,
  AlertTriangle,
  ChevronRight,
  User,
  Bot,
  Lock,
  Unlock,
  RefreshCw,
} from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import TrustGauge from '@/components/TrustGauge';
import { useRealtimeContext, RealtimeMessage } from '@/components/Providers/RealtimeProvider';
import { MissionMetadata } from '@claw/core/lib/types/memory';

interface CognitiveSignalPayload {
  type: string;
  agentId?: string;
  content?: string;
  trust?: number;
  stability?: number;
  budget?: number;
}
interface MissionControlHUDProps {
  sessionId: string | null;
  mission?: MissionMetadata;
}

interface ActivityEvent {
  id: string;
  timestamp: number;
  type: 'ALPHA' | 'BETA' | 'SYSTEM' | 'USER';
  message: string;
}

export const MissionControlHUD: React.FC<MissionControlHUDProps> = ({ sessionId, mission }) => {
  const { subscribe } = useRealtimeContext();
  // Derive pseudo-random defaults from sessionId to show visual difference when switching
  const hash = sessionId
    ? sessionId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    : 0;
  const defaultTrust = 85 + (hash % 15);
  const defaultStability = 80 + (hash % 20);
  const defaultBudget = 40 + (hash % 40);

  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [autonomyMode, setAutonomyMode] = useState<'HITL' | 'AUTO'>('HITL');
  const [trustScore, setTrustScore] = useState(mission?.trustScore ?? defaultTrust);
  const [stabilityScore, setStabilityScore] = useState(mission?.stabilityScore ?? defaultStability);
  const [budgetUsage, setBudgetUsage] = useState(mission?.budgetUsage ?? defaultBudget);

  useEffect(() => {
    // Subscribe to mission signals
    if (!sessionId) return;

    const unsubscribe = subscribe(
      [`sessions/${sessionId}/signal`],
      (topic: string, message: RealtimeMessage) => {
        const payload = message as unknown as CognitiveSignalPayload;
        if (payload.type === 'COGNITIVE_SIGNAL') {
          const newEvent: ActivityEvent = {
            id: Math.random().toString(36).substr(2, 9),
            timestamp: Date.now(),
            type: payload.agentId?.includes('alpha') ? 'ALPHA' : 'SYSTEM',
            message: payload.content || 'Processing signal...',
          };
          setActivities((prev) => [newEvent, ...prev].slice(0, 5));

          if (payload.trust) setTrustScore(payload.trust);
          if (payload.stability) setStabilityScore(payload.stability);
          if (payload.budget) setBudgetUsage(payload.budget);
        }
      }
    );

    return () => unsubscribe();
  }, [sessionId, subscribe, mission?.trustScore, mission?.stabilityScore, mission?.budgetUsage]);

  useEffect(() => {
    // Mock initial activities if empty
    setTimeout(() => {
      setActivities((prev) => {
        if (prev.length === 0) {
          return [
            {
              id: '1',
              timestamp: Date.now() - 10000,
              type: 'SYSTEM',
              message: 'Mission initialized. Session protocols active.',
            },
            {
              id: '2',
              timestamp: Date.now() - 5000,
              type: 'ALPHA',
              message: 'Analyzing workspace state... context acquired.',
            },
          ];
        }
        return prev;
      });
    }, 0);
  }, []); // Only on mount

  const toggleAutonomy = () => {
    setAutonomyMode((prev) => (prev === 'HITL' ? 'AUTO' : 'HITL'));
  };

  return (
    <div className="w-80 border-l border-border bg-background/40 backdrop-blur-md flex flex-col h-full overflow-hidden animate-in slide-in-from-right duration-300 transition-all ease-in-out">
      <div className="p-4 border-b border-border bg-card/20">
        <Typography
          variant="mono"
          weight="black"
          className="text-[10px] uppercase tracking-[0.3em] flex items-center gap-2 text-muted-foreground"
        >
          <Zap size={12} className="text-cyber-green" /> Mission_Control
        </Typography>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
        {/* Sector 1: Cognitive HUD */}
        <section className="space-y-4">
          <Typography
            variant="mono"
            className="text-[9px] uppercase tracking-widest font-bold opacity-50"
          >
            Cognitive_Metrics
          </Typography>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 bg-card/30 p-3 rounded-lg border border-border/50">
              <TrustGauge score={trustScore} label="" size={60} />
              <div className="flex-1">
                <Typography
                  variant="mono"
                  className="text-[10px] font-bold uppercase tracking-tighter block"
                >
                  Trust_Index:
                </Typography>
                <div className="flex items-center gap-2">
                  <Typography variant="h3" color="primary" glow className="text-lg">
                    {trustScore}%
                  </Typography>
                  <Badge variant="primary" className="text-[8px] py-0 px-1 font-black">
                    STABLE
                  </Badge>
                </div>
              </div>
              <div className="w-1.5 h-12 bg-muted/20 rounded-full overflow-hidden flex flex-col justify-end">
                <div
                  className="bg-cyber-green w-full shadow-[0_0_10px_rgba(0,255,163,0.5)]"
                  style={{ height: `${trustScore}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 bg-card/30 p-3 rounded-lg border border-border/50">
              <div className="w-12 h-12 rounded-full border-2 border-cyber-blue/20 flex items-center justify-center relative">
                <Activity size={20} className="text-cyber-blue" />
                <svg className="absolute inset-0 w-full h-full -rotate-90">
                  <circle
                    cx="24"
                    cy="24"
                    r="22"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-cyber-blue/10"
                  />
                  <circle
                    cx="24"
                    cy="24"
                    r="22"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray="138"
                    strokeDashoffset={138 * (1 - stabilityScore / 100)}
                    className="text-cyber-blue"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <Typography
                  variant="mono"
                  className="text-[10px] font-bold uppercase tracking-tighter block"
                >
                  Stability:
                </Typography>
                <div className="flex items-center gap-2">
                  <Typography variant="h3" className="text-cyber-blue text-lg" glow>
                    {stabilityScore}%
                  </Typography>
                  <Badge variant="intel" className="text-[8px] py-0 px-1 font-black">
                    NORMAL
                  </Badge>
                </div>
              </div>
              <div className="w-1.5 h-12 bg-muted/20 rounded-full overflow-hidden flex flex-col justify-end">
                <div
                  className="bg-cyber-blue w-full shadow-[0_0_10px_rgba(0,255,255,0.5)]"
                  style={{ height: `${stabilityScore}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 bg-card/30 p-3 rounded-lg border border-border/50">
              <div className="w-12 h-12 rounded-full border-2 border-orange-500/20 flex items-center justify-center">
                <Wallet size={20} className="text-orange-500" />
              </div>
              <div className="flex-1">
                <Typography
                  variant="mono"
                  className="text-[10px] font-bold uppercase tracking-tighter block"
                >
                  Budget_Used:
                </Typography>
                <div className="flex items-center gap-2">
                  <Typography variant="h3" className="text-orange-500 text-lg" glow>
                    {budgetUsage}%
                  </Typography>
                  <Badge
                    variant="outline"
                    className="text-[8px] py-0 px-1 font-black border-orange-500/30 text-orange-500"
                  >
                    OPTIMAL
                  </Badge>
                </div>
              </div>
              <div className="w-1.5 h-12 bg-muted/20 rounded-full overflow-hidden flex flex-col justify-end">
                <div
                  className="bg-orange-500 w-full shadow-[0_0_10px_rgba(249,115,22,0.5)]"
                  style={{ height: `${budgetUsage}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 bg-card/30 p-3 rounded-lg border border-border/50">
              <div className="w-12 h-12 rounded-full border-2 border-purple-500/20 flex items-center justify-center">
                <RefreshCw size={20} className="text-purple-500" />
              </div>
              <div className="flex-1">
                <Typography
                  variant="mono"
                  className="text-[10px] font-bold uppercase tracking-tighter block"
                >
                  Self_Correction:
                </Typography>
                <div className="flex items-center gap-2">
                  <Typography variant="h3" className="text-purple-500 text-lg" glow>
                    12
                  </Typography>
                  <Badge
                    variant="outline"
                    className="text-[8px] py-0 px-1.5 font-black border-purple-500/30 text-purple-500"
                  >
                    EVOLVING
                  </Badge>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Typography variant="mono" className="text-[8px] opacity-40">
                  AUTO_REPAIR
                </Typography>
                <div className="flex gap-0.5">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="w-1 h-1 rounded-full bg-purple-500 shadow-[0_0_5px_rgba(168,85,247,0.5)]"
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Sector 2: Activity Ticker */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <Typography
              variant="mono"
              className="text-[9px] uppercase tracking-widest font-bold opacity-50"
            >
              Nerve_Center_Ticker
            </Typography>
            <div className="w-2 h-2 rounded-full bg-cyber-green animate-pulse" />
          </div>

          <div className="space-y-2 max-h-48 overflow-hidden">
            {activities.map((event) => (
              <div
                key={event.id}
                className="group border-l-2 border-border hover:border-cyber-green transition-all pl-3 py-1"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <Typography
                    variant="mono"
                    className={`text-[8px] font-black uppercase ${event.type === 'ALPHA' ? 'text-cyber-green' : event.type === 'SYSTEM' ? 'text-cyber-blue' : 'text-orange-500'}`}
                  >
                    [{event.type}]
                  </Typography>
                  <Typography variant="mono" className="text-[8px] opacity-30">
                    {new Date(event.timestamp).toLocaleTimeString([], {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </Typography>
                </div>
                <Typography
                  variant="caption"
                  className="text-[9px] line-clamp-1 group-hover:line-clamp-none transition-all"
                >
                  {event.message}
                </Typography>
              </div>
            ))}
          </div>
        </section>

        {/* Sector 3: Autonomy Controls */}
        <section className="space-y-4 pt-4 border-t border-border/50">
          <Typography
            variant="mono"
            className="text-[9px] uppercase tracking-widest font-bold opacity-50"
          >
            Autonomy_Protocol
          </Typography>

          <Card variant="glass" padding="sm" className="bg-card/40 border-border/60">
            <div className="flex items-center justify-between mb-4">
              <div
                className={`flex items-center gap-2 transition-colors ${autonomyMode === 'HITL' ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                <User size={14} />
                <Typography variant="mono" className="text-[10px] font-bold">
                  HITL
                </Typography>
              </div>

              <button
                onClick={toggleAutonomy}
                aria-label={`Toggle autonomy mode to ${autonomyMode === 'HITL' ? 'AUTO' : 'HITL'}`}
                className={`w-12 h-6 rounded-full relative transition-all duration-300 ${autonomyMode === 'AUTO' ? 'bg-cyber-green/20 border-cyber-green/50' : 'bg-muted/20 border-border'} border`}
              >
                <div
                  className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-all duration-300 flex items-center justify-center ${autonomyMode === 'AUTO' ? 'translate-x-6 bg-cyber-green' : 'bg-muted-more shadow-md'}`}
                >
                  {autonomyMode === 'AUTO' ? (
                    <Unlock size={8} className="text-background" />
                  ) : (
                    <Lock size={8} className="text-background" />
                  )}
                </div>
              </button>

              <div
                className={`flex items-center gap-2 transition-colors ${autonomyMode === 'AUTO' ? 'text-cyber-green' : 'text-muted-foreground'}`}
              >
                <Typography variant="mono" className="text-[10px] font-bold">
                  AUTO
                </Typography>
                <Bot size={14} />
              </div>
            </div>

            <button className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded text-red-500 text-[10px] font-black uppercase tracking-[0.2em] transition-all group">
              Manual_Override
              <ChevronRight
                size={12}
                className="inline ml-1 group-hover:translate-x-1 transition-transform"
              />
            </button>
          </Card>

          <div className="bg-card/20 p-3 rounded border border-dashed border-border flex gap-3">
            <AlertTriangle size={14} className="text-yellow-500 shrink-0 mt-0.5" />
            <Typography variant="caption" className="text-[8px] leading-relaxed opacity-60 italic">
              Goverance override active for Class C actions. Automated escalation protocols in
              effect.
            </Typography>
          </div>
        </section>
      </div>

      <div className="p-3 border-t border-border bg-card/10 text-center">
        <Typography variant="mono" className="text-[8px] text-muted-more uppercase tracking-widest">
          Neural_Engine_Sync_v2.4
        </Typography>
      </div>
    </div>
  );
};
