'use client';

import React, { useState, useTransition, useEffect } from 'react';
import { Cpu, Zap, Loader2, X, Search, ExternalLink } from 'lucide-react';
import { updateAgentTools } from '../../app/capabilities/actions';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import Button from '../ui/Button';
import Typography from '../ui/Typography';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import CyberConfirm from '../CyberConfirm';
import type { Tool } from '@/lib/types/ui';

import { AgentConfig } from './types';

interface AgentsTabProps {
  allTools: Tool[];
  agents: AgentConfig[];
  optimisticAgents: AgentConfig[];
  setOptimisticAgents: React.Dispatch<React.SetStateAction<AgentConfig[]>>;
  searchQuery: string;
}

export default function AgentsTab({ 
  allTools, 
  agents, 
  optimisticAgents, 
  setOptimisticAgents,
  searchQuery
}: AgentsTabProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [modalSearchQuery, setModalSearchQuery] = useState('');
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant: 'danger' | 'warning';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    variant: 'warning'
  });

  const universalSkills = ['discoverSkills', 'installSkill'];

  const getToolGroup = (toolName: string) => {
    if (toolName.startsWith('aws-s3')) return 'S3_STORAGE';
    if (toolName.startsWith('aws')) return 'AWS_INFRA';
    if (toolName.startsWith('filesystem')) return 'FILESYSTEM';
    if (toolName.startsWith('git')) return 'GIT_VERSIONING';
    if (toolName.startsWith('google-search') || toolName.startsWith('puppeteer') || toolName.startsWith('fetch')) return 'WEB_INTEL';
    if (universalSkills.includes(toolName)) return 'CORE_NEURAL';
    return 'DYNAMO_SKILLS';
  };

  const handleToggleToolAssignment = async (agentId: string, toolName: string, isAttached: boolean) => {
    const formData = new FormData();
    formData.append('agentId', agentId);
    
    const agent = optimisticAgents.find(a => a.id === agentId);
    if (!agent) return;

    let newTools: string[];
    if (isAttached) {
        newTools = agent.tools.filter(t => t !== toolName);
    } else {
        newTools = [...agent.tools, toolName];
    }
    
    newTools.forEach(t => formData.append('tools', t));

    setOptimisticAgents(prev => prev.map(a => 
      a.id === agentId ? { ...a, tools: newTools } : a
    ));

    startTransition(async () => {
      try {
        const result = await updateAgentTools(formData);
        if (result?.error) throw new Error(result.error);
        toast.success(isAttached ? `Revoked ${toolName} from ${agentId}` : `Assigned ${toolName} to ${agentId}`);
        router.refresh();
      } catch (error) {
        toast.error('Sync failed. Reverting changes.');
        setOptimisticAgents(agents);
      }
    });
  };

  const selectedAgent = optimisticAgents.find(a => a.id === selectedAgentId);

  const filteredAgents = optimisticAgents
    .filter((a: any) => a.id !== 'monitor' && a.id !== 'events' && a.id !== 'recovery')
    .filter((a: any) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return a.name.toLowerCase().includes(query) || a.tools.some((t: any) => t.toLowerCase().includes(query));
    });

  return (
    <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <CyberConfirm 
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAgents.map(agent => (
          <Card 
            variant="glass" 
            padding="lg" 
            key={agent.id} 
            className="cyber-border border-white/5 hover:border-yellow-500/20 transition-all flex flex-col justify-between group"
          >
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded bg-yellow-500/10 flex items-center justify-center text-yellow-500 border border-yellow-500/20 shadow-[0_0_20px_rgba(234,179,8,0.1)]">
                   {agent.id === 'main' ? <Zap size={24} /> : agent.id === 'coder' ? <Cpu size={24} /> : <Cpu size={24} />}
                </div>
                <div>
                  <Typography variant="body" weight="black" color="white" className="tracking-widest uppercase text-sm">
                    {agent.name}
                  </Typography>
                  <Typography variant="mono" color="muted" className="text-[8px] uppercase tracking-tighter opacity-40">
                    NEURAL_ID: {agent.id}
                  </Typography>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 border-y border-white/5 py-6">
                <div className="text-center">
                  <Typography variant="h3" color="primary" weight="black" className="text-xl leading-none">{agent.tools.length}</Typography>
                  <Typography variant="mono" color="muted" className="text-[8px] uppercase tracking-widest mt-1 opacity-40">Active Skills</Typography>
                </div>
                <div className="text-center border-l border-white/5">
                  <Typography variant="h3" color="white" weight="black" className="text-xl leading-none opacity-40">{allTools.length - agent.tools.length}</Typography>
                  <Typography variant="mono" color="muted" className="text-[8px] uppercase tracking-widest mt-1 opacity-40">Untapped</Typography>
                </div>
              </div>
            </div>

            <div className="mt-8">
              <Button
                onClick={() => setSelectedAgentId(agent.id)}
                variant="ghost"
                size="sm"
                className="w-full font-black text-[9px] tracking-[0.2em] border-white/10 hover:border-yellow-500/40 hover:text-yellow-500 group-hover:bg-yellow-500/5 transition-all"
                icon={<Cpu size={12} />}
              >
                OPEN NEURAL ROSTER
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Neural Roster Management Modal */}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
          <Card variant="glass" className="w-full max-w-4xl max-h-[90vh] flex flex-col border-yellow-500/20 shadow-[0_0_100px_rgba(234,179,8,0.1)] overflow-hidden">
            {/* Modal Header */}
            <div className="p-8 border-b border-white/10 flex justify-between items-center bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-yellow-500/5 via-transparent to-transparent">
              <div className="flex items-center gap-6">
                <div className="w-14 h-14 rounded bg-yellow-500/20 flex items-center justify-center text-yellow-500 border border-yellow-500/40 shadow-[0_0_30px_rgba(234,179,8,0.2)]">
                   {selectedAgent.id === 'main' ? <Zap size={32} /> : <Cpu size={32} />}
                </div>
                <div>
                  <Typography variant="h3" weight="black" color="primary" className="tracking-[0.3em] mb-1">
                    {selectedAgent.name}
                  </Typography>
                  <Typography variant="caption" color="muted" className="tracking-widest uppercase opacity-60">
                     Cognitive Pathway Configuration Registry
                  </Typography>
                </div>
              </div>
              <button 
                onClick={() => { setSelectedAgentId(null); setModalSearchQuery(''); }}
                className="p-3 bg-white/5 hover:bg-red-500/20 hover:text-red-500 border border-white/10 transition-all rounded"
              >
                <X size={24} />
              </button>
            </div>

            {/* Sub-header with Search */}
            <div className="px-8 py-4 bg-white/[0.02] border-b border-white/10 flex gap-4">
              <div className="relative flex-1 group">
                <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-yellow-500 transition-colors" />
                <input 
                  type="text"
                  placeholder="Filter neural patterns by name or protocol..."
                  value={modalSearchQuery}
                  onChange={(e) => setModalSearchQuery(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 focus:border-yellow-500/40 rounded p-3 pl-10 text-[10px] font-mono outline-none tracking-widest placeholder:text-white/10"
                />
              </div>
              <div className="flex items-center gap-2 px-4 border border-white/10 rounded bg-black/40">
                 <Typography variant="mono" color="muted" className="text-[10px] tracking-widest uppercase opacity-40">Status:</Typography>
                 <Badge variant="outline" className="text-[10px] border-yellow-500/20 text-yellow-500">{selectedAgent.tools.length} Attached</Badge>
              </div>
            </div>

            {/* Modal Body - Scrollable Area */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-12">
              {(() => {
                const categorizedTools: Record<string, Tool[]> = {};
                allTools.forEach(tool => {
                  if (modalSearchQuery && !tool.name.toLowerCase().includes(modalSearchQuery.toLowerCase()) && !tool.description.toLowerCase().includes(modalSearchQuery.toLowerCase())) return;
                  const group = getToolGroup(tool.name);
                  if (!categorizedTools[group]) categorizedTools[group] = [];
                  categorizedTools[group].push(tool);
                });

                if (Object.keys(categorizedTools).length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-20 opacity-20 border border-dashed border-white/10 rounded">
                       <Search size={48} className="mb-4" />
                       <Typography variant="mono" className="tracking-widest">NO_PATTERNS_MATCHED</Typography>
                    </div>
                  );
                }

                return Object.entries(categorizedTools).map(([groupName, groupTools]) => (
                  <div key={groupName} className="space-y-6">
                    <div className="flex items-center gap-4">
                      <Typography variant="mono" color="muted" className="text-[10px] tracking-[0.5em] uppercase font-black whitespace-nowrap opacity-40">
                        {groupName.replace('_', ' ')}
                      </Typography>
                      <div className="h-px w-full bg-white/5" />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {groupTools.map(tool => {
                        const isAttached = selectedAgent.tools.includes(tool.name);
                        const isUniversal = universalSkills.includes(tool.name);
                        
                        return (
                          <div 
                            key={tool.name}
                            className={`group/item p-4 border rounded transition-all flex justify-between items-center ${
                              isAttached 
                                ? 'bg-yellow-500/[0.03] border-yellow-500/20' 
                                : 'bg-white/[0.01] border-white/5 hover:border-white/10'
                            }`}
                          >
                            <div className="space-y-1 pr-6 flex-1 min-w-0">
                               <div className="flex items-center gap-2">
                                  <Typography variant="mono" weight="black" className={`text-xs truncate ${isAttached ? 'text-yellow-500' : 'text-white/60'}`}>
                                    {tool.name}
                                  </Typography>
                                  {tool.isExternal && <Badge variant="outline" className="text-[7px] py-0 border-purple-500/20 text-purple-400">BRIDGE</Badge>}
                               </div>
                               <Typography variant="caption" className="text-[9px] text-white/20 line-clamp-1 tracking-tighter">
                                  {tool.description}
                               </Typography>
                            </div>

                            <Button 
                              variant={isAttached ? 'primary' : 'ghost'}
                              size="sm"
                              disabled={isPending || isUniversal}
                              onClick={() => handleToggleToolAssignment(selectedAgent.id, tool.name, isAttached)}
                              className={`min-w-[100px] font-black tracking-widest text-[8px] h-9 transition-all relative group/btn ${
                                isAttached 
                                  ? 'bg-red-500/80 hover:bg-red-600 border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
                                  : 'border-white/10 text-white/40 hover:text-white hover:border-yellow-500/40'
                              }`}
                              icon={isPending ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
                            >
                              {isAttached ? 'DETACH' : 'ATTACH'}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>

            <div className="p-6 bg-yellow-500/[0.02] border-t border-white/5 text-center">
               <Typography variant="mono" color="muted" className="text-[8px] tracking-[0.4em] opacity-30">
                 NEURAL_SYNC_ACTIVE: CHANGES_IMMEDIATELY_PERSISTED_TO_DYNAMODB_CORE
               </Typography>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}