'use client';

import React, { useEffect, useState } from 'react';
import { Brain, Target, Cpu, Zap, Activity, ShieldAlert, CheckCircle2 } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { toast } from 'sonner';
import CognitiveHealthCard from '@/components/CognitiveHealthCard';
import { Anomaly } from '@/lib/types/dashboard';

interface MetabolismFinding {
  silo: string;
  expected: string;
  actual: string;
  severity: string;
  recommendation: string;
}

interface AgentHealth {
  agentId: string;
  score: number;
  taskCompletionRate: number;
  reasoningCoherence: number;
  errorRate: number;
  memoryFragmentation: number;
  anomalies: Anomaly[];
}

export default function CognitiveView() {
  const [agents, setAgents] = useState<AgentHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [metabolizing, setMetabolizing] = useState(false);
  const [findings, setFindings] = useState<MetabolismFinding[]>([]);

  useEffect(() => {
    fetch('/api/cognitive-health')
      .then((res) => res.json())
      .then((data) => setAgents(data.agents ?? []))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  const runMetabolism = async (repair = false) => {
    setMetabolizing(true);
    setFindings([]);
    try {
      const res = await fetch('/api/system/metabolism', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repair }),
      });
      const data = await res.json();
      if (res.ok) {
        setFindings(data.findings || []);
        if (repair) {
          toast.success('System Metabolism: Regenerative repairs executed.');
        } else {
          toast.info('System Metabolism: Audit completed.');
        }
      } else {
        toast.error(`Metabolism failed: ${data.error}`);
      }
    } catch {
      toast.error('Failed to trigger metabolism.');
    } finally {
      setMetabolizing(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agents.length > 0 ? (
          agents.map((agent) => <CognitiveHealthCard key={agent.agentId} {...agent} />)
        ) : (
          <div className="col-span-full h-48 flex flex-col items-center justify-center opacity-20 border-dashed border-2 border-border rounded-xl">
            <Brain size={32} className="mb-4" />
            <Typography variant="body">No active cognitive traces</Typography>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <Card variant="glass" padding="lg" className="border-cyan-500/10 bg-cyan-500/[0.02]">
            <Typography
              variant="caption"
              weight="black"
              className="tracking-widest flex items-center gap-2 mb-4 text-cyan-400"
            >
              <Cpu size={14} /> Neural_Sync_Status
            </Typography>
            <div className="space-y-4 font-mono text-[10px]">
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-muted-foreground">COHERENCE_AVG</span>
                <span className="text-cyan-400 font-bold">98.2%</span>
              </div>
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-muted-foreground">LATENCY_P99</span>
                <span className="text-cyan-400 font-bold">1.2s</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">CROSS_AGENT_TRUST</span>
                <span className="text-cyber-green font-bold text-[8px] uppercase tracking-tighter">
                  [OPTIMAL]
                </span>
              </div>
            </div>
          </Card>

          <Card
            variant="outline"
            padding="lg"
            className="border-cyber-blue/20 bg-cyber-blue/[0.02]"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-cyber-blue" />
                <Typography variant="mono" weight="bold" uppercase className="text-xs">
                  Regenerative_Metabolism
                </Typography>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runMetabolism(false)}
                  disabled={metabolizing}
                  className="text-[9px] uppercase tracking-widest px-3"
                >
                  Audit
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => runMetabolism(true)}
                  disabled={metabolizing}
                  className="text-[9px] uppercase tracking-widest px-3 bg-cyber-blue/20 text-cyber-blue border-cyber-blue/30 hover:bg-cyber-blue/40"
                  icon={metabolizing ? <Activity size={10} className="animate-spin" /> : undefined}
                >
                  Repair
                </Button>
              </div>
            </div>

            <div className="space-y-3 min-h-[120px] max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {findings.length > 0 ? (
                findings.map((f, i) => (
                  <div
                    key={i}
                    className="p-3 bg-foreground/[0.02] border border-white/5 rounded-lg space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {f.severity === 'P0' || f.severity === 'P1' ? (
                          <ShieldAlert size={12} className="text-red-500" />
                        ) : (
                          <Activity size={12} className="text-amber-500" />
                        )}
                        <Typography variant="mono" className="text-[10px] uppercase font-bold">
                          {f.silo}::{f.severity}
                        </Typography>
                      </div>
                      <Typography
                        variant="mono"
                        color="muted-more"
                        className="text-[8px] uppercase"
                      >
                        {f.actual.length > 30 ? f.actual.substring(0, 30) + '...' : f.actual}
                      </Typography>
                    </div>
                    <Typography variant="body" className="text-[11px] leading-snug">
                      {f.recommendation}
                    </Typography>
                  </div>
                ))
              ) : (
                <div className="h-24 flex flex-col items-center justify-center opacity-30 text-center">
                  {metabolizing ? (
                    <Typography variant="mono" className="text-[10px] animate-pulse">
                      Scanning System State...
                    </Typography>
                  ) : (
                    <>
                      <CheckCircle2 size={24} className="mb-2 text-cyber-green" />
                      <Typography variant="mono" className="text-[9px] uppercase tracking-widest">
                        System state optimal. No pending debt detected.
                      </Typography>
                    </>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>

        <Card variant="outline" padding="lg" className="border-border/30 bg-card/20 h-fit">
          <Typography variant="caption" weight="bold" className="mb-2 flex items-center gap-2">
            <Target size={14} className="text-cyber-green" /> Objective Alignment
          </Typography>
          <Typography variant="body" className="text-xs opacity-70 leading-relaxed block">
            The Cognitive Sector analyzes the reasoning patterns of the active swarm. Score
            represents the alignment between intent and action. Anomalies are detected using
            high-entropy variance analysis in the trace logs.
          </Typography>
        </Card>
      </div>
    </div>
  );
}
