'use client';

import React from 'react';
import { Activity } from 'lucide-react';
import Typography from '../ui/Typography';
import Card from '../ui/Card';
import type { Tool } from '@/lib/types/ui';
import { AgentConfig } from './types';

interface LeaderboardTabProps {
  allTools: Tool[];
  optimisticAgents: AgentConfig[];
  searchQuery?: string;
}

export default function LeaderboardTab({
  allTools,
  optimisticAgents,
  searchQuery = '',
}: LeaderboardTabProps) {
  const sortedByUsage = [...allTools].sort((a, b) => (b.usage?.count ?? 0) - (a.usage?.count ?? 0));

  const filteredTools = sortedByUsage
    .filter((t) => (t.usage?.count || 0) > 0)
    .filter(
      (t) =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

  return (
    <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <h4 className="text-[12px] font-black uppercase tracking-[0.4em] text-white/40 flex items-center gap-2">
          <Activity size={16} className="text-cyber-blue" /> Total neural invocations
        </h4>
        <Typography variant="mono" color="muted" className="text-[10px] opacity-40">
          RANKED BY HISTORICAL UTILIZATION
        </Typography>
      </div>

      <Card variant="solid" className="border-white/5 bg-black/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="p-4 text-[10px] font-black tracking-widest text-white/40">
                  Capability
                </th>
                <th className="p-4 text-[10px] font-black tracking-widest text-white/40">
                  Total invocations
                </th>
                <th className="p-4 text-[10px] font-black tracking-widest text-white/40">
                  Last active
                </th>
                <th className="p-4 text-[10px] font-black tracking-widest text-white/40">
                  Attached nodes
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTools.map((tool) => {
                const attachedAgents = optimisticAgents.filter((a) => a.tools.includes(tool.name));
                return (
                  <tr
                    key={tool.name}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group"
                  >
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span
                          className={`text-xs font-black tracking-wider ${tool.isExternal ? 'text-purple-400' : 'text-yellow-500'}`}
                        >
                          {tool.name}
                        </span>
                        {tool.isExternal && (
                          <span className="text-[8px] opacity-30 font-bold">External bridge</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 bg-white/5 rounded-full flex-1 max-w-[150px] overflow-hidden">
                          <div
                            className={`h-full ${tool.isExternal ? 'bg-purple-500' : 'bg-yellow-500'}`}
                            style={{
                              width: `${Math.min(100, ((tool.usage?.count ?? 0) / (sortedByUsage[0]?.usage?.count ?? 1)) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-mono font-bold text-white/80">
                          {tool.usage?.count}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-[10px] font-mono text-white/40">
                        {tool.usage?.lastUsed
                          ? new Date(tool.usage.lastUsed).toLocaleTimeString()
                          : 'NEVER'}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex -space-x-2">
                        {attachedAgents.map((a) => (
                          <div
                            key={a.id}
                            title={a.name}
                            className="w-6 h-6 rounded-full bg-cyber-blue/20 border border-cyber-blue/40 flex items-center justify-center text-[8px] font-black text-cyber-blue ring-2 ring-black"
                          >
                            {a.name.substring(0, 1)}
                          </div>
                        ))}
                        {attachedAgents.length === 0 && (
                          <span className="text-[10px] text-white/10 italic">Unassigned</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredTools.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="p-10 text-center text-white/20 italic text-xs tracking-widest"
                  >
                    No neural activity detected for current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
