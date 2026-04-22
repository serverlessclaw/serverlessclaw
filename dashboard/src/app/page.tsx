'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  MessageSquare,
  Activity,
  Settings,
  Plus,
  Brain,
  ShieldCheck,
  ArrowRight,
  Clock,
} from 'lucide-react';
import Skeleton from '@/components/ui/Skeleton';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/PageHeader';
import { ROUTES } from '@/lib/constants';

interface SessionMetadata {
  sessionId: string;
  title: string;
  updatedAt: number;
}

/**
 * MissionDashboard — The new Command & Control center for Serverless Claw.
 * Provides a high-level overview of active missions, system health, and quick actions.
 */
export default function MissionDashboard() {
  const [recentSessions, setRecentSessions] = useState<SessionMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/chat')
      .then((res) => res.json())
      .then((data) => {
        const sorted = (data.sessions || [])
          .sort((a: SessionMetadata, b: SessionMetadata) => b.updatedAt - a.updatedAt)
          .slice(0, 3);
        setRecentSessions(sorted);
      })
      .catch(() => setRecentSessions([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex-1 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-green/5 via-transparent to-transparent">
      <PageHeader titleKey="DASHBOARD_TITLE" subtitleKey="CHAT_SUBTITLE" />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Sector 1: Active Missions */}
        <div className="xl:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <Typography
              variant="caption"
              weight="black"
              className="tracking-[0.2em] flex items-center gap-2"
            >
              <MessageSquare size={14} className="text-cyber-green" /> Recent_Missions
            </Typography>
            <Link href={ROUTES.CHAT}>
              <Button
                variant="ghost"
                size="sm"
                className="text-[10px] uppercase font-bold tracking-widest hover:text-cyber-green"
              >
                Intelligence Sector <ArrowRight size={12} className="ml-1" />
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {loading ? (
              <>
                <Card variant="glass" padding="lg" className="h-32 border-border/40 bg-card/60">
                  <div className="flex flex-col h-full justify-between gap-4">
                    <div className="space-y-2">
                      <Skeleton variant="text" width="80%" />
                      <Skeleton variant="text" width="40%" />
                    </div>
                    <div className="flex justify-end">
                      <Skeleton variant="rectangular" width={60} height={16} />
                    </div>
                  </div>
                </Card>
                <Card variant="glass" padding="lg" className="h-32 border-border/40 bg-card/60">
                  <div className="flex flex-col h-full justify-between gap-4">
                    <div className="space-y-2">
                      <Skeleton variant="text" width="70%" />
                      <Skeleton variant="text" width="30%" />
                    </div>
                    <div className="flex justify-end">
                      <Skeleton variant="rectangular" width={60} height={16} />
                    </div>
                  </div>
                </Card>
              </>
            ) : recentSessions.length > 0 ? (
              recentSessions.map((session) => (
                <Link key={session.sessionId} href={`${ROUTES.CHAT}?session=${session.sessionId}`}>
                  <Card
                    variant="glass"
                    padding="lg"
                    className="h-full hover:border-cyber-green/30 transition-all group border-border/40 bg-card/60"
                  >
                    <div className="flex flex-col h-full justify-between gap-4">
                      <div>
                        <Typography
                          variant="caption"
                          weight="bold"
                          className="block mb-2 group-hover:text-cyber-green transition-colors truncate"
                        >
                          {session.title || 'Untitled Operation'}
                        </Typography>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                          <Clock size={12} /> {new Date(session.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Badge
                          variant="outline"
                          className="text-[8px] opacity-40 group-hover:opacity-100 transition-opacity"
                        >
                          Resume_Task
                        </Badge>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))
            ) : (
              <Card
                variant="outline"
                padding="lg"
                className="col-span-full border-dashed border-border/40 bg-card/10 h-32 flex flex-col items-center justify-center text-center opacity-40"
              >
                <Typography variant="caption">No active mission logs detected.</Typography>
                <Link
                  href={ROUTES.CHAT}
                  className="mt-2 text-cyber-green text-[10px] uppercase font-bold hover:underline"
                >
                  Initiate New Conversation
                </Link>
              </Card>
            )}

            <Link href={ROUTES.CHAT}>
              <Card
                variant="outline"
                padding="lg"
                className="h-full border-dashed border-cyber-green/20 hover:border-cyber-green/50 bg-cyber-green/[0.02] transition-all flex items-center justify-center group cursor-pointer"
              >
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-cyber-green/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Plus size={20} className="text-cyber-green" />
                  </div>
                  <Typography
                    variant="mono"
                    className="text-[10px] uppercase font-bold text-cyber-green tracking-widest"
                  >
                    New_Operation
                  </Typography>
                </div>
              </Card>
            </Link>
          </div>
        </div>

        {/* Sector 2: Quick Status HUD */}
        <div className="space-y-6">
          <Typography
            variant="caption"
            weight="black"
            className="tracking-[0.2em] flex items-center gap-2"
          >
            <Activity size={14} className="text-cyber-blue" /> Nerve_Center_Summary
          </Typography>

          <Card
            variant="glass"
            padding="lg"
            className="border-cyber-blue/20 bg-cyber-blue/[0.02] space-y-6"
          >
            <div className="flex items-center justify-between border-b border-border/20 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-cyber-blue/10 flex items-center justify-center text-cyber-blue">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <Typography
                    variant="mono"
                    className="text-[10px] font-bold uppercase tracking-wider block"
                  >
                    System_Stability
                  </Typography>
                  <Typography variant="caption" color="muted" className="text-[8px]">
                    All circuits operational
                  </Typography>
                </div>
              </div>
              <Typography
                variant="mono"
                className="text-cyber-green font-bold text-xs uppercase tracking-tighter"
              >
                [NOMINAL]
              </Typography>
            </div>

            <div className="flex items-center justify-between border-b border-border/20 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-cyan-400/10 flex items-center justify-center text-cyan-400">
                  <Brain size={18} />
                </div>
                <div>
                  <Typography
                    variant="mono"
                    className="text-[10px] font-bold uppercase tracking-wider block"
                  >
                    Cognitive_Health
                  </Typography>
                  <Typography variant="caption" color="muted" className="text-[8px]">
                    Cross-Agent Trust: 98.4%
                  </Typography>
                </div>
              </div>
              <Typography
                variant="mono"
                className="text-cyan-400 font-bold text-xs uppercase tracking-tighter"
              >
                GOOD
              </Typography>
            </div>

            <Link href={ROUTES.OBSERVABILITY}>
              <Button
                variant="outline"
                className="w-full text-[10px] uppercase tracking-widest py-2 border-cyber-blue/30 text-cyber-blue hover:bg-cyber-blue/5"
              >
                Inspect Nerve Center
              </Button>
            </Link>
          </Card>

          <Card variant="outline" padding="lg" className="border-border opacity-60">
            <div className="flex items-center gap-2 text-muted-foreground mb-3">
              <Settings size={14} />
              <Typography
                variant="mono"
                className="text-[10px] uppercase font-bold tracking-widest"
              >
                Operator_Quick_Actions
              </Typography>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Link href={ROUTES.AGENTS}>
                <button className="w-full text-left p-2 rounded bg-card/60 hover:bg-card border border-border/40 text-[9px] uppercase font-mono tracking-wider transition-colors">
                  Sync_Agents
                </button>
              </Link>
              <Link href={ROUTES.SECURITY}>
                <button className="w-full text-left p-2 rounded bg-card/60 hover:bg-card border border-border/40 text-[9px] uppercase font-mono tracking-wider transition-colors">
                  Safety_Scan
                </button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
