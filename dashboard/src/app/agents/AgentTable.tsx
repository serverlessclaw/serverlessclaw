'use client';

import React, { useState } from 'react';
import { Eye, Trash2, Shield, ShieldAlert, Bot, Wrench, Copy } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Agent } from '@/lib/types/ui';
import AgentDetailModal from './AgentDetailModal';

interface AgentTableProps {
  agents: Record<string, Agent>;
  reputation?: Record<
    string,
    { successRate: number; avgLatencyMs: number; tasksCompleted: number; tasksFailed: number }
  >;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  deleteAgent: (id: string) => void;
  cloneAgent: (id: string) => void;
  setSelectedAgentIdForTools: (id: string | null) => void;
  onSave: () => void;
  saving: boolean;
  hasChanges: boolean;
}

export default function AgentTable({
  agents,
  reputation,
  updateAgent,
  deleteAgent,
  cloneAgent,
  setSelectedAgentIdForTools,
  onSave,
  saving,
  hasChanges,
}: AgentTableProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const agentList = Object.values(agents);
  const selectedAgent = selectedAgentId ? agents[selectedAgentId] : null;

  return (
    <>
      <div className="glass-card overflow-hidden border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40">
                  Agent
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40">
                  Type
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40 text-center">
                  Status
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40">
                  Provider
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40">
                  Model
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40 text-center">
                  Tools
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40 text-center">
                  Reputation
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/40 text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {agentList.map((agent) => {
                const isLogicOnly =
                  agent.id === 'monitor' || agent.id === 'recovery' || agent.id === 'events';

                return (
                  <tr
                    key={agent.id}
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={`hover:bg-white/[0.03] transition-colors cursor-pointer group ${
                      agent.isBackbone ? 'bg-cyan-500/[0.02]' : ''
                    }`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-1.5 rounded ${
                            agent.isBackbone
                              ? 'bg-cyan-500/20 text-cyan-400'
                              : 'bg-white/5 text-white/70'
                          }`}
                        >
                          {isLogicOnly ? (
                            <ShieldAlert size={14} />
                          ) : agent.isBackbone ? (
                            <Shield size={14} />
                          ) : (
                            <Bot size={14} />
                          )}
                        </div>
                        <div className="flex flex-col">
                          <Typography
                            variant="mono"
                            weight="bold"
                            className="text-xs text-white/90"
                          >
                            {agent.name}
                          </Typography>
                          <Typography variant="mono" className="text-[9px] text-white/30 mt-0.5">
                            {agent.id}
                          </Typography>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {agent.isBackbone ? (
                        <Badge variant="intel" className="py-0 whitespace-nowrap">
                          Backbone
                        </Badge>
                      ) : isLogicOnly ? (
                        <Badge variant="audit" className="py-0 whitespace-nowrap">
                          System Logic
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="py-0 whitespace-nowrap">
                          Dynamic
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!agent.isBackbone) updateAgent(agent.id, { enabled: !agent.enabled });
                        }}
                        className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border transition-colors ${
                          agent.enabled
                            ? 'bg-green-500/10 text-green-400 border-green-500/20'
                            : 'bg-white/5 text-white/30 border-white/10'
                        } ${agent.isBackbone ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-white/10'}`}
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${agent.enabled ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-white/20'}`}
                        />
                        {agent.enabled ? 'Active' : 'Off'}
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <Typography variant="mono" className="text-[11px] text-white/50">
                        {agent.provider
                          ? agent.provider.charAt(0).toUpperCase() + agent.provider.slice(1)
                          : 'Default'}
                      </Typography>
                    </td>
                    <td className="px-5 py-3">
                      <Typography
                        variant="mono"
                        className="text-[11px] text-white/50 truncate max-w-[180px] block"
                      >
                        {agent.model || '-'}
                      </Typography>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedAgentIdForTools(agent.id);
                        }}
                        className="inline-flex items-center gap-1 text-white/50 hover:text-green-400 font-mono text-xs transition-colors"
                      >
                        <Wrench size={10} />
                        {agent.tools?.length ?? 0}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-center">
                      {reputation && reputation[agent.id] ? (
                        <Typography
                          variant="mono"
                          className={`text-[11px] font-bold ${
                            reputation[agent.id].successRate >= 0.8
                              ? 'text-green-400'
                              : reputation[agent.id].successRate >= 0.5
                                ? 'text-amber-400'
                                : 'text-red-400'
                          }`}
                        >
                          {(reputation[agent.id].successRate * 100).toFixed(0)}%
                        </Typography>
                      ) : (
                        <Typography variant="mono" className="text-[11px] text-white/30">
                          -
                        </Typography>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAgentId(agent.id);
                          }}
                          className="text-white/50 hover:text-cyan-400 p-1"
                          icon={<Eye size={14} />}
                          title="View Details"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            cloneAgent(agent.id);
                          }}
                          className="text-white/50 hover:text-blue-400 p-1"
                          icon={<Copy size={14} />}
                          title="Clone Agent"
                        />
                        {!agent.isBackbone && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAgent(agent.id);
                            }}
                            className="text-white/50 hover:text-red-500 p-1"
                            icon={<Trash2 size={14} />}
                            title="Delete"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AgentDetailModal
        agent={selectedAgent}
        reputation={reputation}
        onClose={() => setSelectedAgentId(null)}
        updateAgent={updateAgent}
        onDelete={(id) => {
          setSelectedAgentId(null);
          deleteAgent(id);
        }}
        onOpenTools={(id) => {
          setSelectedAgentId(null);
          setSelectedAgentIdForTools(id);
        }}
        onSave={onSave}
        saving={saving}
        hasChanges={hasChanges}
      />
    </>
  );
}
