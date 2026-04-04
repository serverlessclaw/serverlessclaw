'use client';

import React, { useEffect, useState } from 'react';
import { Vote, Activity, Users } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import SwarmConsensusView from '@/components/SwarmConsensusView';
import CollaborationCanvas from '@/components/CollaborationCanvas';

interface ConsensusRequest {
  id: string;
  title: string;
  description: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  mode: 'MAJORITY' | 'UNANIMOUS' | 'WEIGHTED';
  votes: { agentId: string; vote: 'YES' | 'NO'; reason?: string; reputation: number }[];
  timestamp: number;
}

type Tab = 'consensus' | 'live';

export default function CollaborationPage() {
  const [requests, setRequests] = useState<ConsensusRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('consensus');

  useEffect(() => {
    async function fetchConsensus() {
      try {
        const res = await fetch('/api/consensus');
        const data = await res.json();
        setRequests(data.requests || []);
      } catch (e) {
        console.error('Failed to fetch consensus requests:', e);
      } finally {
        setIsLoading(false);
      }
    }

    fetchConsensus();
  }, []);

  const tabs = [
    {
      id: 'consensus' as Tab,
      label: 'Swarm Consensus',
      icon: Vote,
      count: requests.filter((r) => r.status === 'PENDING').length,
    },
    { id: 'live' as Tab, label: 'Live Tasks', icon: Activity },
  ];

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
      <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end border-b border-white/5 pb-6 gap-6">
        <div>
          <div className="flex items-center gap-3">
            <Typography
              variant="h2"
              color="white"
              glow
              uppercase
              className="flex items-center gap-3"
            >
              <Users size={28} className="text-cyber-blue" /> Collaboration
            </Typography>
          </div>
          <Typography variant="body" color="muted" className="mt-2 block">
            Multi-agent governance, consensus voting, and real-time task orchestration.
          </Typography>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-white/5 pb-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-all
                ${
                  isActive
                    ? 'bg-cyber-blue/10 text-cyber-blue border border-cyber-blue/30'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5 border border-transparent'
                }
              `}
            >
              <Icon size={14} />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className={`
                  ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold
                  ${isActive ? 'bg-cyber-blue/20 text-cyber-blue' : 'bg-white/10 text-white/50'}
                `}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'consensus' &&
        (isLoading ? (
          <div className="py-20 text-center">
            <Typography variant="body" color="muted">
              Loading consensus requests...
            </Typography>
          </div>
        ) : (
          <SwarmConsensusView requests={requests} />
        ))}

      {activeTab === 'live' && (
        <div className="h-[600px] glass-card border-white/5 overflow-hidden">
          <CollaborationCanvas />
        </div>
      )}
    </main>
  );
}
