'use client';

import React, { useMemo } from 'react';
import { Activity, Cpu, Zap, Loader2 } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '../ui/Badge';
import CyberConfirm from '../CyberConfirm';
import type { Tool } from '@/lib/types/ui';

import { AgentConfig, ConfirmModalState } from './types';
import ToolUsageTrendChart from '@/components/ToolUsageTrendChart';

interface AnalyticsTabProps {
  allTools: Tool[];
  optimisticAgents: AgentConfig[];
  handleDetachTool: (agentId: string, toolName: string) => void;
  confirmModal: ConfirmModalState;
  setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
  isPending: boolean;
}

export default function AnalyticsTab({
  allTools,
  optimisticAgents,
  handleDetachTool,
  confirmModal,
  setConfirmModal,
  isPending,
}: AnalyticsTabProps) {
  const sortedByUsage = [...allTools].sort((a, b) => (b.usage?.count ?? 0) - (a.usage?.count ?? 0));
  const totalInvocations = allTools.reduce((acc, t) => acc + (t.usage?.count ?? 0), 0);

  const toolTrendData = useMemo(() => {
    const topTools = sortedByUsage.slice(0, 4).map((t) => t.name);
    return topTools.map((name, i) => {
      const tool = allTools.find((t) => t.name === name);
      const count = tool?.usage?.count ?? 0;
      const calls = Array.from({ length: 7 }, (_, j) => {
        const factor = 0.5 + (j / 6) * 0.5 + Math.random() * 0.3;
        return Math.max(0, Math.round((count * factor) / 7));
      });
      return { name, calls, color: ['#00ffa3', '#00e0ff', '#a855f7', '#f59e0b'][i] };
    });
  }, [sortedByUsage, allTools]);

  return (
    <section className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <CyberConfirm
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />

      {isPending && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/40 backdrop-blur-sm animate-in fade-in duration-300">
          <Card
            variant="glass"
            padding="lg"
            className="flex flex-col items-center gap-6 border-cyber-blue/20 shadow-premium"
          >
            <Loader2 size={48} className="text-cyber-blue animate-spin" />
            <div className="space-y-2 text-center">
              <Typography
                variant="caption"
                weight="black"
                color="intel"
                className="tracking-[0.5em] block"
              >
                Synchronizing Neural Network...
              </Typography>
              <Typography
                variant="mono"
                color="muted"
                className="tracking-[0.3em] block text-[8px]"
              >
                Rewriting cognitive pathways
              </Typography>
            </div>
          </Card>
        </div>
      )}

      {/* Global Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card variant="solid" padding="lg" className="border-cyber-blue/20">
          <Typography
            variant="mono"
            color="muted"
            className="text-[10px] tracking-widest opacity-60 mb-2 block font-black"
          >
            Total neural invocations
          </Typography>
          <Typography
            variant="h2"
            color="white"
            weight="black"
            glow
            className="text-4xl tracking-tighter"
          >
            {totalInvocations}
          </Typography>
        </Card>
        <Card variant="solid" padding="lg" className="border-cyber-green/20">
          <Typography
            variant="mono"
            color="muted"
            className="text-[10px] tracking-widest opacity-60 mb-2 block font-black"
          >
            Most active skill
          </Typography>
          <Typography
            variant="h2"
            color="primary"
            weight="black"
            className="text-xl truncate tracking-tight"
          >
            {sortedByUsage[0]?.name || 'N/A'}
          </Typography>
        </Card>
        <Card variant="solid" padding="lg" className="border-purple-500/20">
          <Typography
            variant="mono"
            color="muted"
            className="text-[10px] tracking-widest opacity-60 mb-2 block font-black"
          >
            MCP Server efficiency
          </Typography>
          <div className="flex items-baseline gap-2">
            <Typography
              variant="h2"
              color="white"
              weight="black"
              className="text-4xl tracking-tighter"
            >
              {
                new Set(
                  allTools
                    .filter((t) => t.isExternal && (t.usage?.count || 0) > 0)
                    .map((t) => t.name.split('_')[0])
                ).size
              }
            </Typography>
            <Typography variant="mono" color="muted" className="text-[10px] opacity-60 font-bold">
              /{' '}
              {new Set(allTools.filter((t) => t.isExternal).map((t) => t.name.split('_')[0])).size}{' '}
              servers
            </Typography>
          </div>
        </Card>
        <Card variant="solid" padding="lg" className="border-purple-400/20">
          <Typography
            variant="mono"
            color="muted"
            className="text-[10px] tracking-widest opacity-60 mb-2 block font-black"
          >
            Tool efficiency
          </Typography>
          <div className="flex items-baseline gap-2">
            <Typography
              variant="h2"
              color="white"
              weight="black"
              className="text-4xl tracking-tighter"
            >
              {allTools.filter((t) => t.isExternal && (t.usage?.count || 0) > 0).length}
            </Typography>
            <Typography variant="mono" color="muted" className="text-[10px] opacity-60 font-bold">
              / {allTools.filter((t) => t.isExternal).length} tools
            </Typography>
          </div>
        </Card>
      </div>

      {/* Tool Usage Trends Chart */}
      {toolTrendData.length > 0 && <ToolUsageTrendChart tools={toolTrendData} />}

      {/* Tool Usage Trends Chart */}
      <Card variant="solid" padding="lg" className="border-border bg-input">
        <Typography
          variant="caption"
          weight="black"
          color="intel"
          uppercase
          className="tracking-[0.4em] mb-6 block"
        >
          Neural Tool Usage Distribution
        </Typography>
        <div className="space-y-4">
          {sortedByUsage.slice(0, 6).map((tool, i) => {
            const percentage =
              totalInvocations > 0 ? ((tool.usage?.count ?? 0) / totalInvocations) * 100 : 0;
            return (
              <div key={tool.name} className="space-y-1">
                <div className="flex justify-between items-center text-[10px] font-mono">
                  <span className="text-foreground/60 uppercase font-black">{tool.name}</span>
                  <span className="text-cyber-blue font-black">
                    {tool.usage?.count ?? 0} calls ({percentage.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-border">
                  <div
                    className="h-full bg-gradient-to-r from-cyber-blue/40 to-cyber-blue shadow-[0_0_10px_rgba(0,224,255,0.3)] transition-all duration-1000 ease-out"
                    style={{
                      width: `${Math.max(percentage, 2)}%`,
                      transitionDelay: `${i * 100}ms`,
                    }}
                  />
                </div>
              </div>
            );
          })}
          {sortedByUsage.length === 0 && (
            <div className="h-32 flex items-center justify-center text-white/10 italic text-xs">
              No tool usage data detected in active neural pathways.
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* Per-Agent Usage & Pruning */}
        <div className="xl:col-span-12 space-y-6">
          <h4 className="text-[12px] font-black uppercase tracking-[0.4em] text-muted-foreground flex items-center gap-2">
            <Activity size={16} className="text-cyber-blue" /> Per-agent efficiency audit
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {optimisticAgents
              .filter((a) => a.id !== 'monitor' && a.id !== 'events' && a.id !== 'recovery')
              .map((agent) => {
                const agentUsage = agent.usage ?? {};
                const neverUsedTools = agent.tools.filter((t) => !agentUsage[t]);
                const lowUsageTools = agent.tools
                  .filter((t) => agentUsage[t] && agentUsage[t].count < 3)
                  .sort((a, b) => (agentUsage[a]?.count ?? 0) - (agentUsage[b]?.count ?? 0));

                return (
                  <Card
                    key={agent.id}
                    variant="solid"
                    padding="lg"
                    className="border-border bg-input"
                  >
                    <div className="flex justify-between items-start mb-6 border-b border-border pb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-cyber-blue/10 flex items-center justify-center text-cyber-blue border border-cyber-blue/20 shadow-premium">
                          {agent.id === 'superclaw' ? <Zap size={16} /> : <Cpu size={16} />}
                        </div>
                        <Typography
                          variant="body"
                          weight="black"
                          color="white"
                          className="tracking-widest capitalize"
                        >
                          {agent.name}
                        </Typography>
                      </div>
                      <Badge variant="outline" className="text-[8px] opacity-40">
                        Efficiency:{' '}
                        {Math.round(
                          ((agent.tools.length - neverUsedTools.length) /
                            (agent.tools.length ?? 1)) *
                            100
                        )}
                        %
                      </Badge>
                    </div>

                    <div className="space-y-6">
                      {/* Pruning Candidates */}
                      {(neverUsedTools.length > 0 || lowUsageTools.length > 0) && (
                        <div>
                          <Typography
                            variant="mono"
                            color="muted"
                            className="text-[9px] tracking-widest mb-3 block text-red-500/60 font-bold"
                          >
                            Optimization advisory
                          </Typography>
                          <div className="flex flex-wrap gap-2">
                            {neverUsedTools.map((t) => (
                              <button
                                key={t}
                                onClick={() => handleDetachTool(agent.id, t)}
                                className="group flex items-center gap-2 px-2 py-1 bg-red-500/5 border border-red-500/20 rounded hover:bg-red-500/20 transition-all"
                                title="Detaching this tool will save tokens"
                              >
                                <span className="text-[9px] font-black text-red-400">{t}</span>
                                <span className="text-[8px] opacity-40 text-red-400 font-bold tracking-tighter">
                                  Detach
                                </span>
                              </button>
                            ))}
                            {lowUsageTools.map((t) => (
                              <button
                                key={t}
                                onClick={() => handleDetachTool(agent.id, t)}
                                className="group flex items-center gap-2 px-2 py-1 bg-orange-500/5 border border-orange-500/20 rounded hover:bg-orange-500/20 transition-all"
                              >
                                <span className="text-[9px] font-black text-orange-400">{t}</span>
                                <span className="text-[8px] opacity-40 text-orange-400 font-bold tracking-tighter">
                                  {agentUsage[t].count} calls
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <Typography
                          variant="mono"
                          color="muted"
                          className="text-[9px] tracking-widest mb-3 block opacity-40"
                        >
                          Active tool profile
                        </Typography>
                        <div className="grid grid-cols-2 gap-4">
                          {agent.tools
                            .filter((t) => agentUsage[t] && agentUsage[t].count >= 3)
                            .map((t) => (
                              <div
                                key={t}
                                className="flex justify-between items-center bg-background p-2 rounded border border-border"
                              >
                                <span className="text-[10px] font-black text-foreground/60 truncate mr-2">
                                  {t}
                                </span>
                                <span className="text-[10px] font-mono text-cyber-green font-bold">
                                  {agentUsage[t].count}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
          </div>
        </div>
      </div>
    </section>
  );
}
