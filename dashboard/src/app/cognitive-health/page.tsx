'use client';

import { useEffect, useState } from 'react';
import { Loader2, Brain } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import CognitiveHealthCard from '@/components/CognitiveHealthCard';
import HealthTrendChart from '@/components/HealthTrendChart';
import { Anomaly } from '@/lib/types/dashboard';

interface AgentHealth {
  agentId: string;
  score: number;
  taskCompletionRate: number;
  reasoningCoherence: number;
  errorRate: number;
  memoryFragmentation: number;
  anomalies: Anomaly[];
}

export default function CognitiveHealthPage() {
  const [agents, setAgents] = useState<AgentHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/cognitive-health')
      .then((res) => res.json())
      .then((data) => setAgents(data.agents ?? []))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  const avgScore = agents.length > 0
    ? Math.round(agents.reduce((sum, a) => sum + a.score, 0) / agents.length)
    : 0;

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyan-500/5 via-transparent to-transparent">
      <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end border-b border-white/5 pb-6 gap-6">
        <div>
          <Typography variant="h2" color="white" glow uppercase>
            Deep Cognitive Health
          </Typography>
          <Typography variant="body" color="muted" className="mt-2 block">
            Real-time neural coherence and reasoning integrity monitor.
          </Typography>
        </div>
        <div className="flex gap-4">
          <Card variant="glass" padding="sm" className="px-4 py-2 min-w-[120px]">
            <Typography variant="mono" color="white" className="mb-1 block opacity-90">Agents</Typography>
            <Typography variant="h3" weight="bold" className="text-cyan-400">{agents.length}</Typography>
          </Card>
          <Card variant="glass" padding="sm" className="px-4 py-2 min-w-[120px]">
            <Typography variant="mono" color="white" className="mb-1 block opacity-90">Avg Score</Typography>
            <Typography variant="h3" weight="bold" className={avgScore >= 80 ? 'text-[var(--cyber-green)]' : avgScore >= 60 ? 'text-amber-400' : 'text-red-500'}>
              {avgScore}
            </Typography>
          </Card>
        </div>
      </header>

      {!loading && agents.length > 0 && (
        <div className="max-w-4xl">
          <HealthTrendChart currentScore={avgScore} />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 size={32} className="animate-spin text-cyan-400" />
        </div>
      ) : agents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent) => (
            <CognitiveHealthCard key={agent.agentId} {...agent} />
          ))}
        </div>
      ) : (
        <Card variant="solid" padding="lg" className="h-48 flex flex-col items-center justify-center opacity-20 border-dashed">
          <Brain size={32} className="mb-4" />
          <Typography variant="body" weight="normal">No cognitive health data available</Typography>
          <Typography variant="caption" color="muted" className="mt-2 block">Agents will appear once health metrics are recorded.</Typography>
        </Card>
      )}
    </main>
  );
}
