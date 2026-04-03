'use client';

import React from 'react';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import { Vote, CheckCircle2, XCircle, Info, UserCheck, ShieldCheck } from 'lucide-react';

interface ConsensusVote {
  agentId: string;
  vote: 'YES' | 'NO';
  reason?: string;
  reputation: number;
}

interface ConsensusRequest {
  id: string;
  title: string;
  description: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  mode: 'MAJORITY' | 'UNANIMOUS' | 'WEIGHTED';
  votes: ConsensusVote[];
  timestamp: number;
}

export default function SwarmConsensusView({ requests }: { requests: ConsensusRequest[] }) {
  return (
    <div className="space-y-10">
      {requests.map((req) => {
        const yesVotes = req.votes.filter(v => v.vote === 'YES').length;
        const noVotes = req.votes.filter(v => v.vote === 'NO').length;
        const totalVotes = req.votes.length;
        const yesPercent = totalVotes > 0 ? (yesVotes / totalVotes) * 100 : 0;

        return (
          <div key={req.id} className="bg-[#0A0A0B] border border-white/10 rounded-2xl p-6 lg:p-8 space-y-6 shadow-2xl relative overflow-hidden">
            {/* Status Indicator */}
            <div className={`absolute top-0 left-0 w-1 h-full ${
              req.status === 'APPROVED' ? 'bg-cyber-green' : 
              req.status === 'REJECTED' ? 'bg-red-500' : 'bg-cyber-blue'
            }`} />

            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-6">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <Badge variant="outline" className="text-[10px] border-white/10 uppercase tracking-widest text-white/40">
                    ID: {req.id}
                  </Badge>
                  <Badge variant="intel" className="text-[10px] uppercase tracking-widest">
                    MODE: {req.mode}
                  </Badge>
                </div>
                <Typography variant="h3" uppercase glow>{req.title}</Typography>
                <Typography variant="body" color="muted" className="text-white/60 leading-relaxed">
                  {req.description}
                </Typography>
              </div>

              <div className="bg-white/5 border border-white/10 p-6 rounded-2xl min-w-[240px] text-center space-y-4">
                <Typography variant="mono" className="text-xs uppercase tracking-widest opacity-40">Voting Progress</Typography>
                <div className="relative w-32 h-32 mx-auto">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-white/5" />
                    <circle 
                      cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" 
                      className={req.status === 'APPROVED' ? 'text-cyber-green' : 'text-cyber-blue'}
                      strokeDasharray={364.4}
                      strokeDashoffset={364.4 - (364.4 * yesPercent) / 100}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <Typography variant="h3" className="font-black leading-none">{yesPercent.toFixed(0)}%</Typography>
                    <Typography variant="mono" className="text-[10px] uppercase opacity-40 mt-1">APPROVAL</Typography>
                  </div>
                </div>
                <div className="flex justify-center gap-4 border-t border-white/5 pt-4">
                  <div className="text-center">
                    <Typography variant="h3" className="text-cyber-green">{yesVotes}</Typography>
                    <Typography variant="mono" className="text-[9px] uppercase opacity-40 font-bold">YES</Typography>
                  </div>
                  <div className="text-center">
                    <Typography variant="h3" className="text-red-500">{noVotes}</Typography>
                    <Typography variant="mono" className="text-[9px] uppercase opacity-40 font-bold">NO</Typography>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2 opacity-40 px-2">
                <Vote size={14} />
                <Typography variant="mono" className="text-xs uppercase tracking-widest font-black">Audit Trail (Agent Votes)</Typography>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {req.votes.map((vote) => (
                  <div key={vote.agentId} className="bg-white/[0.03] border border-white/5 p-4 rounded-xl hover:bg-white/[0.06] transition-all group">
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-white/5 rounded text-white/40 group-hover:text-cyber-blue transition-colors">
                          <UserCheck size={14} />
                        </div>
                        <Typography variant="mono" className="text-xs font-bold uppercase truncate w-24">{vote.agentId}</Typography>
                      </div>
                      {vote.vote === 'YES' ? 
                        <CheckCircle2 size={16} className="text-cyber-green" /> : 
                        <XCircle size={16} className="text-red-500" />
                      }
                    </div>
                    <Typography variant="body" className="text-[11px] text-white/40 italic line-clamp-2 min-h-[32px]">
                      &quot;{vote.reason || 'No reasoning provided.'}&quot;
                    </Typography>
                    <div className="mt-3 flex items-center gap-2 border-t border-white/5 pt-3">
                      <ShieldCheck size={10} className="text-cyber-blue/40" />
                      <Typography variant="mono" className="text-[10px] text-cyber-blue/40 uppercase tracking-tighter">Reputation: {(vote.reputation * 100).toFixed(0)}</Typography>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      {requests.length === 0 && (
        <div className="py-20 text-center bg-white/5 border border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-4">
          <Info size={32} className="text-white/10" />
          <Typography variant="body" color="muted">No active consensus requests pending swarm governance.</Typography>
        </div>
      )}
    </div>
  );
}
