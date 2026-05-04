'use client';

import React from 'react';
import {
  Target,
  Users,
  Map,
  CheckSquare,
  Clock,
  ChevronRight,
  Plus,
  User,
  Bot,
} from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { TranslationKey } from '@/components/Providers/TranslationsProvider';
import { usePresence } from '@/components/Providers/PresenceProvider';
import { MissionMetadata } from '@claw/core/lib/types/memory';

interface MissionBriefingProps {
  sessionId: string | null;
  collaborators: string[];
  mission?: MissionMetadata;
  t: (key: TranslationKey) => string;
}

export const MissionBriefing: React.FC<MissionBriefingProps> = ({
  sessionId,
  collaborators,
  mission: sessionMission,
}) => {
  const { members, myPresence } = usePresence();

  // Merge static collaborators with real-time presence
  const allCollaborators = [
    ...(myPresence ? [myPresence] : []),
    ...members,
    ...collaborators
      .filter((id) => id !== myPresence?.memberId && !members.some((m) => m.memberId === id))
      .map((id) => ({
        memberId: id,
        displayName: id,
        type: 'agent' as const,
        status: 'offline' as const,
      })),
  ];

  // Mock mission data
  // Merge provided session mission with defaults for visualization
  const mission = sessionMission ?? {
    name: sessionId ? `Operation_${sessionId.slice(-6).toUpperCase()}` : 'Awaiting_Mission',
    status: 'ACTIVE',
    goal: `Strategic analysis for mission ${sessionId || 'unknown'} in progress.`,
    phases: [
      { id: '1', label: 'Context Acquisition', status: 'completed' },
      { id: '2', label: 'Strategic Planning', status: 'active' },
      { id: '3', label: 'Execution', status: 'pending' },
      { id: '4', label: 'Verification', status: 'pending' },
    ],
  };

  return (
    <div className="w-72 border-r border-border bg-background/40 backdrop-blur-md flex flex-col h-full overflow-hidden animate-in slide-in-from-left duration-300 transition-all ease-in-out">
      <div className="p-4 border-b border-border bg-card/20 flex items-center justify-between">
        <Typography
          variant="mono"
          weight="black"
          className="text-[10px] uppercase tracking-[0.3em] flex items-center gap-2 text-muted-foreground"
        >
          <Target size={12} className="text-cyber-blue" /> Mission_Hub
        </Typography>
        <button className="p-1 hover:bg-foreground/5 rounded transition-colors">
          <Plus size={14} className="text-muted-foreground" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-8">
        {/* Sector 1: Collaborators */}
        <section className="space-y-4">
          <Typography
            variant="mono"
            className="text-[9px] uppercase tracking-widest font-bold opacity-50 flex items-center gap-2"
          >
            <Users size={10} /> Collaborators
          </Typography>

          <div className="space-y-2">
            {allCollaborators.map((member) => (
              <div
                key={member.memberId}
                className="flex items-center justify-between p-2 rounded-lg hover:bg-card/40 transition-colors border border-transparent hover:border-border/40 group"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full border border-border flex items-center justify-center relative ${member.type === 'human' ? 'bg-cyber-green/10 border-cyber-green/30' : 'bg-card'}`}
                  >
                    {member.type === 'human' ? (
                      <User size={14} className="text-cyber-green" />
                    ) : (
                      <Bot size={14} className="text-cyber-blue" />
                    )}
                    <div
                      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${member.status === 'online' ? 'bg-cyber-green' : member.status === 'away' ? 'bg-yellow-500' : 'bg-muted-more'}`}
                    />
                  </div>
                  <div>
                    <Typography variant="mono" className="text-[10px] font-bold block uppercase">
                      {member.displayName}
                    </Typography>
                    <Typography variant="caption" className="text-[8px] opacity-40 uppercase">
                      {member.memberId === myPresence?.memberId
                        ? 'Operator (You)'
                        : member.type === 'human'
                          ? 'Specialist'
                          : 'Neural_Agent'}
                    </Typography>
                  </div>
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronRight size={12} className="text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Sector 2: Mission Briefing */}
        <section className="space-y-4">
          <Typography
            variant="mono"
            className="text-[9px] uppercase tracking-widest font-bold opacity-50 flex items-center gap-2"
          >
            <Map size={10} /> Mission_Briefing
          </Typography>

          <Card variant="glass" padding="sm" className="bg-cyber-blue/[0.03] border-cyber-blue/20">
            <div className="space-y-3">
              <div>
                <Typography
                  variant="mono"
                  className="text-[9px] font-black text-cyber-blue uppercase mb-1"
                >
                  {mission.name}
                </Typography>
                <div className="flex items-center gap-2">
                  <Badge variant="intel" className="text-[8px] py-0 px-1.5 font-black">
                    {mission.status}
                  </Badge>
                </div>
              </div>

              <div>
                <Typography variant="mono" className="text-[8px] opacity-40 uppercase mb-1 block">
                  Current_Goal:
                </Typography>
                <Typography variant="caption" className="text-[10px] font-bold leading-relaxed">
                  {mission.goal}
                </Typography>
              </div>
            </div>
          </Card>
        </section>

        {/* Sector 3: Operational Phases */}
        <section className="space-y-4">
          <Typography
            variant="mono"
            className="text-[9px] uppercase tracking-widest font-bold opacity-50 flex items-center gap-2"
          >
            <CheckSquare size={10} /> Operational_Phases
          </Typography>

          <div className="space-y-4 relative pl-3">
            <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />

            {(mission.phases || []).map((phase) => (
              <div key={phase.id} className="relative flex items-start gap-4">
                <div
                  className={`absolute -left-5 w-4 h-4 rounded-full border-2 border-background flex items-center justify-center z-10 transition-colors ${phase.status === 'completed' ? 'bg-cyber-green border-cyber-green' : phase.status === 'active' ? 'bg-background border-cyber-blue' : 'bg-background border-border'}`}
                >
                  {phase.status === 'completed' && (
                    <div className="w-1.5 h-1.5 bg-background rounded-full" />
                  )}
                  {phase.status === 'active' && (
                    <div className="w-1.5 h-1.5 bg-cyber-blue rounded-full animate-pulse" />
                  )}
                </div>

                <div className="flex-1">
                  <Typography
                    variant="mono"
                    className={`text-[10px] font-bold uppercase block ${phase.status === 'pending' ? 'opacity-30' : phase.status === 'active' ? 'text-cyber-blue' : 'text-cyber-green'}`}
                  >
                    {phase.label}
                  </Typography>
                  <Typography variant="caption" className="text-[8px] opacity-40 uppercase">
                    {phase.status}
                  </Typography>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Sector 4: Time Metrics */}
        <section className="space-y-4">
          <Typography
            variant="mono"
            className="text-[9px] uppercase tracking-widest font-bold opacity-50 flex items-center gap-2"
          >
            <Clock size={10} /> Mission_Clock
          </Typography>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-card/30 p-2 rounded border border-border/50">
              <Typography variant="mono" className="text-[8px] opacity-40 uppercase block mb-1">
                Elapsed:
              </Typography>
              <Typography variant="mono" className="text-xs font-bold">
                01:42:15
              </Typography>
            </div>
            <div className="bg-card/30 p-2 rounded border border-border/50">
              <Typography variant="mono" className="text-[8px] opacity-40 uppercase block mb-1">
                ETA:
              </Typography>
              <Typography variant="mono" className="text-xs font-bold text-cyber-blue">
                ~15m
              </Typography>
            </div>
          </div>
        </section>
      </div>

      <div className="p-3 border-t border-border bg-card/10 flex justify-center">
        <Typography variant="mono" className="text-[8px] text-muted-more uppercase tracking-widest">
          Auth_Node: [WS-772]
        </Typography>
      </div>
    </div>
  );
};
