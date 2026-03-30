'use client';

import React, { useEffect, useState } from 'react';
import { Vote } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import SwarmConsensusView from '@/components/SwarmConsensusView';

interface ConsensusRequest {
  id: string;
  title: string;
  description: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  mode: 'MAJORITY' | 'UNANIMOUS' | 'WEIGHTED';
  votes: { agentId: string; vote: 'YES' | 'NO'; reason?: string; reputation: number }[];
  timestamp: number;
}

export default function CollaborationPage() {
  const [requests, setRequests] = useState<ConsensusRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
      <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end border-b border-white/5 pb-6 gap-6">
        <div>
          <div className="flex items-center gap-3">
            <Typography variant="h2" color="white" glow uppercase className="flex items-center gap-3">
              <Vote size={28} className="text-cyber-blue" /> Swarm Consensus
            </Typography>
          </div>
          <Typography variant="body" color="muted" className="mt-2 block">
            Collective decision-making governance for autonomous system evolution.
          </Typography>
        </div>
      </header>

      {isLoading ? (
        <div className="py-20 text-center">
          <Typography variant="body" color="muted">Loading consensus requests...</Typography>
        </div>
      ) : (
        <SwarmConsensusView requests={requests} />
      )}
    </main>
  );
}
