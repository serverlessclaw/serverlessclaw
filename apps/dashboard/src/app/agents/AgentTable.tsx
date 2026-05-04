'use client';

import React from 'react';
import { Eye, Trash2, Shield, ShieldAlert, Bot, Wrench, Copy } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Agent } from '@/lib/types/ui';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { useRouter } from 'next/navigation';

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
}: AgentTableProps) {
  const { t } = useTranslations();
  const router = useRouter();
  const agentList = Object.values(agents);

  return (
    <>
      <div className="glass-card overflow-hidden border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border bg-card">
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted">
                  {t('AGENTS_HEADER')}
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted">
                  {t('AGENTS_TYPE')}
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted text-center">
                  {t('AGENTS_STATUS')}
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted">
                  {t('AGENTS_PROVIDER')}
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted">
                  {t('AGENTS_MODEL')}
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted text-center">
                  {t('AGENTS_TOOLS')}
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted text-center">
                  {t('AGENTS_REPUTATION')}
                </th>
                <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-muted text-right">
                  {t('COMMON_ACTIONS')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {agentList.map((agent) => {
                const isLogicOnly = agent.agentType === 'logic';

                return (
                  <tr
                    key={agent.id}
                    onClick={() => router.push(`/agents/${agent.id}`)}
                    className={`hover:bg-card/50 transition-colors cursor-pointer group ${
                      agent.isBackbone ? 'bg-cyber-blue/[0.02]' : ''
                    }`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-1.5 rounded ${
                            agent.isBackbone
                              ? 'bg-cyber-blue/10 text-cyber-blue'
                              : 'bg-background/40 text-foreground/70'
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
                            className="text-xs text-foreground/90"
                          >
                            {agent.name}
                          </Typography>
                          <Typography variant="mono" className="text-[9px] text-muted mt-0.5">
                            {agent.id}
                          </Typography>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {agent.isBackbone ? (
                        <Badge variant="intel" className="py-0 whitespace-nowrap">
                          {t('AGENTS_BACKBONE')}
                        </Badge>
                      ) : isLogicOnly ? (
                        <Badge variant="audit" className="py-0 whitespace-nowrap">
                          {t('AGENTS_SYSTEM_LOGIC')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="py-0 whitespace-nowrap">
                          {t('AGENTS_DYNAMIC')}
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
                            ? 'bg-cyber-green/10 text-cyber-green border-cyber-green/20'
                            : 'bg-background/40 text-muted border-border'
                        } ${agent.isBackbone ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-card'}`}
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${agent.enabled ? 'bg-cyber-green shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-muted-more'}`}
                        />
                        {agent.enabled ? t('AGENTS_STATUS_ACTIVE') : t('AGENTS_STATUS_OFF')}
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <Typography variant="mono" className="text-[11px] text-muted">
                        {agent.provider
                          ? agent.provider.charAt(0).toUpperCase() + agent.provider.slice(1)
                          : 'Default'}
                      </Typography>
                    </td>
                    <td className="px-5 py-3">
                      <Typography
                        variant="mono"
                        className="text-[11px] text-muted truncate max-w-[180px] block"
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
                        className="inline-flex items-center gap-1 text-muted hover:text-cyber-green font-mono text-xs transition-colors"
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
                        <Typography variant="mono" className="text-[11px] text-muted-more">
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
                            router.push(`/agents/${agent.id}`);
                          }}
                          className="text-muted hover:text-cyber-blue p-1"
                          icon={<Eye size={14} />}
                          title={t('COMMON_VIEW_DETAILS')}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            cloneAgent(agent.id);
                          }}
                          className="text-muted hover:text-cyber-blue p-1"
                          icon={<Copy size={14} />}
                          title={t('AGENTS_CLONE')}
                        />
                        {!agent.isBackbone && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAgent(agent.id);
                            }}
                            className="text-muted hover:text-red-500 p-1"
                            icon={<Trash2 size={14} />}
                            title={t('COMMON_DELETE')}
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
    </>
  );
}
