'use client';

import React from 'react';
import { Activity, Cpu, Zap, Loader2 } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '../ui/Badge';
import CyberConfirm from '../CyberConfirm';
import type { Tool } from '@/lib/types/ui';

import { AgentConfig, ConfirmModalState } from './types';

interface AnalyticsTabProps {
  allTools: Tool[];
  agents: AgentConfig[];
  optimisticAgents: AgentConfig[];
  setOptimisticAgents: React.Dispatch<React.SetStateAction<AgentConfig[]>>;
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
  isPending
}: AnalyticsTabProps) {
  const sortedByUsage = [...allTools].sort((a, b) => (b.usage?.count ?? 0) - (a.usage?.count ?? 0));
  const totalInvocations = allTools.reduce((acc, t) => acc + (t.usage?.count ?? 0), 0);

  return (
    <section className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <CyberConfirm 
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />

      {isPending && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
          <Card variant="glass" padding="lg" className="flex flex-col items-center gap-6 border-cyber-blue/20 shadow-[0_0_50px_rgba(0,224,255,0.1)]">
            <Loader2 size={48} className="text-cyber-blue animate-spin" />
            <div className="space-y-2 text-center">
               <Typography variant="caption" weight="black" color="intel" className="tracking-[0.5em] block">Synchronizing Neural Network...</Typography>
              <Typography variant="mono" color="muted" className="tracking-[0.3em] block text-[8px]">Rewriting cognitive pathways</Typography>
            </div>
          </Card>
        </div>
      )}

      {/* Global Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card variant="glass" padding="lg" className="border-cyber-blue/20">
          <Typography variant="mono" color="muted" className="text-[10px] tracking-widest opacity-40 mb-2 block">Total neural invocations</Typography>
          <Typography variant="h2" color="white" weight="black" glow className="text-4xl tracking-tighter">{totalInvocations}</Typography>
        </Card>
        <Card variant="glass" padding="lg" className="border-cyber-green/20">
          <Typography variant="mono" color="muted" className="text-[10px] tracking-widest opacity-40 mb-2 block">Most active skill</Typography>
          <Typography variant="h2" color="primary" weight="black" className="text-xl truncate tracking-tight">{sortedByUsage[0]?.name || 'N/A'}</Typography>
        </Card>
        <Card variant="glass" padding="lg" className="border-purple-500/20">
          <Typography variant="mono" color="muted" className="text-[10px] tracking-widest opacity-40 mb-2 block">MCP Server efficiency</Typography>
          <div className="flex items-baseline gap-2">
            <Typography variant="h2" color="white" weight="black" className="text-4xl tracking-tighter">
              {new Set(allTools.filter(t => t.isExternal && (t.usage?.count || 0) > 0).map(t => t.name.split('_')[0])).size}
            </Typography>
            <Typography variant="mono" color="muted" className="text-[10px]">/ {new Set(allTools.filter(t => t.isExternal).map(t => t.name.split('_')[0])).size} servers</Typography>
          </div>
        </Card>
        <Card variant="glass" padding="lg" className="border-purple-400/20">
          <Typography variant="mono" color="muted" className="text-[10px] tracking-widest opacity-40 mb-2 block">Tool efficiency</Typography>
          <div className="flex items-baseline gap-2">
            <Typography variant="h2" color="white" weight="black" className="text-4xl tracking-tighter">
              {allTools.filter(t => t.isExternal && (t.usage?.count || 0) > 0).length}
            </Typography>
            <Typography variant="mono" color="muted" className="text-[10px]">/ {allTools.filter(t => t.isExternal).length} tools</Typography>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* Per-Agent Usage & Pruning */}
        <div className="xl:col-span-12 space-y-6">
          <h4 className="text-[12px] font-black uppercase tracking-[0.4em] text-white/40 flex items-center gap-2">
            <Activity size={16} className="text-cyber-blue" /> Per-agent efficiency audit
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {optimisticAgents.filter(a => a.id !== 'monitor' && a.id !== 'events' && a.id !== 'recovery').map(agent => {
              const agentUsage = agent.usage ?? {};
              const neverUsedTools = agent.tools.filter(t => !agentUsage[t]);
              const lowUsageTools = agent.tools
                .filter(t => agentUsage[t] && agentUsage[t].count < 3)
                .sort((a, b) => (agentUsage[a]?.count ?? 0) - (agentUsage[b]?.count ?? 0));

              return (
                <Card key={agent.id} variant="glass" padding="lg" className="border-white/5 bg-black/40">
                  <div className="flex justify-between items-start mb-6 border-b border-white/5 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-cyber-blue/10 flex items-center justify-center text-cyber-blue border border-cyber-blue/20 shadow-[0_0_15px_rgba(0,224,255,0.1)]">
                        {agent.id === 'superclaw' ? <Zap size={16} /> : <Cpu size={16} />}
                      </div>
                      <Typography variant="body" weight="black" color="white" className="tracking-widest capitalize">{agent.name}</Typography>
                    </div>
                    <Badge variant="outline" className="text-[8px] opacity-40">Efficiency: {Math.round((agent.tools.length - neverUsedTools.length) / (agent.tools.length ?? 1) * 100)}%</Badge>
                  </div>

                  <div className="space-y-6">
                    {/* Pruning Candidates */}
                    {(neverUsedTools.length > 0 || lowUsageTools.length > 0) && (
                      <div>
                        <Typography variant="mono" color="muted" className="text-[9px] tracking-widest mb-3 block text-red-500/60 font-bold">Optimization advisory</Typography>
                        <div className="flex flex-wrap gap-2">
                          {neverUsedTools.map(t => (
                            <button 
                              key={t} 
                              onClick={() => handleDetachTool(agent.id, t)}
                              className="group flex items-center gap-2 px-2 py-1 bg-red-500/5 border border-red-500/20 rounded hover:bg-red-500/20 transition-all"
                              title="Detaching this tool will save tokens"
                            >
                              <span className="text-[9px] font-black text-red-400">{t}</span>
                              <span className="text-[8px] opacity-40 text-red-400 font-bold tracking-tighter">Detach</span>
                            </button>
                          ))}
                          {lowUsageTools.map(t => (
                            <button 
                              key={t} 
                              onClick={() => handleDetachTool(agent.id, t)}
                              className="group flex items-center gap-2 px-2 py-1 bg-orange-500/5 border border-orange-500/20 rounded hover:bg-orange-500/20 transition-all"
                            >
                              <span className="text-[9px] font-black text-orange-400">{t}</span>
                              <span className="text-[8px] opacity-40 text-orange-400 font-bold tracking-tighter">{agentUsage[t].count} calls</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <Typography variant="mono" color="muted" className="text-[9px] tracking-widest mb-3 block opacity-40">Active tool profile</Typography>
                      <div className="grid grid-cols-2 gap-4">
                        {agent.tools.filter(t => agentUsage[t] && agentUsage[t].count >= 3).map(t => (
                          <div key={t} className="flex justify-between items-center bg-white/[0.02] p-2 rounded border border-white/5">
                            <span className="text-[10px] font-black text-white/60 truncate mr-2">{t}</span>
                            <span className="text-[10px] font-mono text-cyber-green">{agentUsage[t].count}</span>
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