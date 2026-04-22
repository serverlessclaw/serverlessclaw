import React from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import {
  ArrowLeft,
  Shield,
  Zap,
  History,
  TrendingUp,
  AlertTriangle,
  Settings,
  Bot,
} from 'lucide-react';
import { AgentRegistry } from '@claw/core/lib/registry/AgentRegistry';
import { DynamoMemory, getReputation } from '@claw/core/lib/memory';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import AgentEvolutionCharts from '@/components/Agent/AgentEvolutionCharts';
import AgentTuningHub from '@/components/Agent/AgentTuningHub';

export const dynamic = 'force-dynamic';

async function getAgentData(id: string) {
  const config = await AgentRegistry.getAgentConfig(id);
  const memory = new DynamoMemory();
  const reputation = await getReputation(memory, id);

  return { config, reputation };
}

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { config, reputation } = await getAgentData(id);

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-more">
        <AlertTriangle size={48} className="mb-4 text-red-500" />
        <Typography variant="h2" weight="bold">
          Agent Not Found
        </Typography>
        <Link href="/agents" className="mt-4 text-cyber-blue hover:underline">
          Return to Registry
        </Link>
      </div>
    );
  }

  const successRate = reputation?.successRate ?? 0;
  const avgLatency = reputation?.avgLatencyMs ?? 0;
  const totalTasks = (reputation?.tasksCompleted ?? 0) + (reputation?.tasksFailed ?? 0);

  return (
    <div className="flex-1 space-y-8 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
      <PageHeader
        titleKey={config.name}
        subtitleKey={`ID: ${id} • v${config.version || 1} • ${config.provider}/${config.model}`}
        stats={
          <div className="flex gap-4">
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                SUCCESS
              </Typography>
              <Badge variant="primary" className="px-4 py-1 font-black text-xs">
                {(successRate * 100).toFixed(1)}%
              </Badge>
            </div>
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                TASKS
              </Typography>
              <Badge variant="intel" className="px-4 py-1 font-black text-xs">
                {totalTasks}
              </Badge>
            </div>
          </div>
        }
      >
        <Link href="/agents">
          <Button variant="outline" size="sm" icon={<ArrowLeft size={14} />}>
            Back to Registry
          </Button>
        </Link>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Performance & Evolution Charts */}
        <div className="lg:col-span-2 space-y-8">
          <AgentEvolutionCharts agentId={id} currentVersion={config.version || 1} />

          <Card variant="glass" className="overflow-hidden border-border">
            <div className="p-4 border-b border-border bg-card flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings size={18} className="text-cyber-blue" />
                <Typography
                  variant="mono"
                  weight="bold"
                  uppercase
                  className="text-xs tracking-widest"
                >
                  Core Directive
                </Typography>
              </div>
            </div>
            <div className="p-6 bg-background/40">
              <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
                {config.systemPrompt}
              </pre>
            </div>
          </Card>
        </div>

        {/* Right Column: Tuning Hub & Error Dist */}
        <div className="space-y-8">
          <AgentTuningHub
            agentId={id}
            lastTraceId={reputation?.lastTraceId}
            errorDistribution={reputation?.errorDistribution}
          />
        </div>
      </div>
    </div>
  );
}
