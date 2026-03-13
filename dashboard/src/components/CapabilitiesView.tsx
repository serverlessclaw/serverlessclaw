'use client';

import React, { useState, useTransition } from 'react';
import { Wrench, Shield, Zap, Cpu, Settings, Save, Search, Trash2, X, Plus, Activity, BookOpen, ExternalLink } from 'lucide-react';
import { updateAgentTools, deleteMCPServer } from '../app/capabilities/actions';
import { toast } from 'sonner';
import CyberConfirm from './CyberConfirm';
import { useRouter } from 'next/navigation';

interface Tool {
  name: string;
  description: string;
  isExternal?: boolean;
  usage?: {
    count: number;
    lastUsed: number;
  };
}

interface AgentConfig {
  id: string;
  name: string;
  description: string;
  icon?: string;
  tools: string[];
}

interface CapabilitiesViewProps {
  agents: AgentConfig[];
  allTools: Tool[];
  mcpServers: Record<string, any>;
}

export default function CapabilitiesView({ agents: initialAgents, allTools, mcpServers }: CapabilitiesViewProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'agents' | 'library' | 'mcp'>('agents');
  const [isPending, startTransition] = useTransition();
  const [optimisticAgents, setOptimisticAgents] = useState(initialAgents);

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

  // Sync with props if they change
  React.useEffect(() => {
    setOptimisticAgents(initialAgents);
  }, [initialAgents]);

  const filteredTools = allTools.filter(tool => 
    tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    tool.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleToggleTool = (agentId: string, toolName: string) => {
    const agent = optimisticAgents.find(a => a.id === agentId);
    if (!agent) return;

    const isEnabled = agent.tools.includes(toolName);
    
    if (isEnabled) {
      setConfirmModal({
        isOpen: true,
        title: 'Neural Decoupling',
        message: `Are you sure you want to remove '${toolName}' from ${agent.name}? This will immediately revoke its access to this capability.`,
        variant: 'warning',
        onConfirm: () => executeToggle(agentId, toolName, true)
      });
      return;
    }

    executeToggle(agentId, toolName, false);
  };

  const executeToggle = (agentId: string, toolName: string, isRemoval: boolean) => {
    setConfirmModal(prev => ({ ...prev, isOpen: false }));
    
    const agent = optimisticAgents.find(a => a.id === agentId);
    if (!agent) return;

    const newTools = isRemoval 
      ? agent.tools.filter(t => t !== toolName)
      : [...agent.tools, toolName];
    
    // 1. Optimistic Update
    setOptimisticAgents(prev => prev.map(a => 
      a.id === agentId ? { ...a, tools: newTools } : a
    ));

    // 2. Server Sync
    const formData = new FormData();
    formData.append('agentId', agentId);
    newTools.forEach(t => formData.append('tools', t));

    console.log(`Syncing neural roster for ${agentId}...`, newTools);

    startTransition(async () => {
      try {
        const result = await updateAgentTools(formData);
        if (result?.error) {
          throw new Error(result.error);
        }
        toast.success(`Neural roster synced for ${agentId}`);
        router.refresh();
      } catch (error) {
        console.error('Failed to update tools:', error);
        toast.error(`Failed to sync neural roster: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Revert optimistic update on failure
        setOptimisticAgents(initialAgents);
      }
    });
  };

  const handleRemoveMCPServer = (name: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Bridge Deactivation',
      message: `You are about to unregister the neural bridge '${name}'. All associated dynamic tools will be purged from the system. Proceed?`,
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        startTransition(async () => {
          const result = await deleteMCPServer(name);
          if (result?.error) {
            toast.error(`Failed to deactivate bridge: ${result.error}`);
          } else {
            toast.success(`Neural bridge '${name}' deactivated`);
            router.refresh();
          }
        });
      }
    });
  };

  const universalSkills = ['discoverSkills', 'installSkill'];

  return (
    <div className={`space-y-10 transition-all duration-500 ${isPending ? 'opacity-80' : 'opacity-100'}`}>
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
          <div className="flex flex-col items-center gap-6 glass-card p-10 border-yellow-500/20 shadow-[0_0_50px_rgba(234,179,8,0.1)]">
            <Zap size={48} className="text-yellow-500 animate-pulse" />
            <div className="space-y-2 text-center">
              <span className="text-[12px] font-black text-yellow-500 uppercase tracking-[0.5em] block">Syncing_Neural_Roster...</span>
              <span className="text-[8px] text-white/20 uppercase tracking-[0.3em] block">Rewriting_Cognitive_Pathways</span>
            </div>
          </div>
        </div>
      )}
      {/* Navigation & Search */}
      <div className="flex flex-col lg:flex-row gap-6 justify-between items-start lg:items-center sticky top-0 z-20 bg-black/80 backdrop-blur-xl p-4 -m-4 border-b border-white/5">
        <nav className="flex gap-1 bg-white/5 p-1 rounded-sm border border-white/5">
          {[
            { id: 'agents', label: 'NEURAL_ASSIGNMENTS', icon: Cpu },
            { id: 'library', label: 'TOOL_LIBRARY', icon: BookOpen },
            { id: 'mcp', label: 'NEURAL_BRIDGES', icon: ExternalLink },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-6 py-2 rounded-sm text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id 
                  ? 'bg-yellow-500 text-black shadow-[0_0_20px_rgba(234,179,8,0.2)]' 
                  : 'text-white/40 hover:text-white/60 hover:bg-white/5'
              }`}
            >
              <tab.icon size={12} />
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="relative flex-1 max-w-xl">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search size={16} className="text-yellow-500/50" />
          </div>
          <input
            type="text"
            placeholder="SEARCH_NEURAL_CAPABILITIES..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-black/60 border border-white/10 focus:border-yellow-500/40 rounded-sm py-3 pl-12 pr-4 text-[10px] outline-none transition-all placeholder:text-white/20 font-mono tracking-widest"
          />
        </div>
      </div>

      {activeTab === 'mcp' && (
        <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Object.entries(mcpServers).map(([name, config]) => (
                  <div key={name} className="glass-card p-6 border-white/5 group hover:border-red-500/20 transition-all relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 blur-3xl -mr-16 -mt-16 pointer-events-none" />
                      <div className="flex justify-between items-start mb-6 relative">
                          <div>
                            <span className="text-[12px] font-black text-white uppercase tracking-[0.2em] block mb-1">{name}</span>
                            <span className="text-[8px] bg-yellow-500/10 text-yellow-500/60 px-2 py-0.5 rounded-none uppercase font-bold tracking-tighter">
                                BRIDGE_ACTIVE
                            </span>
                          </div>
                          <button 
                              onClick={() => handleRemoveMCPServer(name)}
                              className="p-2 rounded-sm bg-white/5 text-white/20 hover:bg-red-500 hover:text-white transition-all opacity-0 group-hover:opacity-100 border border-white/10"
                          >
                              <Trash2 size={14} />
                          </button>
                      </div>
                      <div className="space-y-4 relative">
                          <p className="text-[10px] font-mono text-white/40 break-all bg-black/60 p-3 rounded-sm border border-white/5 leading-relaxed">
                              {typeof config === 'string' ? config : config.command}
                          </p>
                          {typeof config !== 'string' && config.env && (
                              <div className="flex flex-wrap gap-2">
                                  {Object.keys(config.env).map(key => (
                                    <span key={key} className="text-[8px] border border-blue-500/20 text-blue-500/60 px-2 py-1 rounded-none uppercase font-bold tracking-tighter">
                                        {key}
                                    </span>
                                  ))}
                              </div>
                          )}
                      </div>
                  </div>
              ))}
              {Object.keys(mcpServers).length === 0 && (
                  <div className="col-span-full py-20 text-center glass-card border-dashed border-white/10 text-white/20 text-[10px] uppercase tracking-[0.5em]">
                      No active neural bridges detected.
                  </div>
              )}
          </div>
        </section>
      )}

      {activeTab === 'agents' && (
        <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 gap-8">
            {optimisticAgents.map(agent => (
              <div key={agent.id} className="glass-card p-8 cyber-border border-yellow-500/10 hover:border-yellow-500/20 transition-all relative overflow-hidden">
                <div className="absolute top-0 right-0 p-2 opacity-5">
                   <Zap size={120} className="text-yellow-500" />
                </div>
                
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 relative">
                  <div className="flex items-center gap-5">
                    <div className="w-14 h-14 rounded-sm bg-yellow-500/10 flex items-center justify-center text-yellow-500 border border-yellow-500/20 shadow-[0_0_30px_rgba(234,179,8,0.1)]">
                       {agent.id === 'main' ? <Zap size={28} /> : agent.id === 'coder' ? <Cpu size={28} /> : <Settings size={28} />}
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-yellow-500 uppercase tracking-[0.3em] mb-1">
                        {agent.name}
                      </h3>
                      <p className="text-[10px] text-white/40 uppercase tracking-widest max-w-xl leading-relaxed">
                        {agent.description || 'Specialized Neural Node'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex gap-3">
                    <span className="text-[10px] font-bold text-white/20 bg-white/5 px-4 py-2 border border-white/5 uppercase tracking-widest">
                      {agent.tools.length} ACTIVE_CHIPS
                    </span>
                  </div>
                </div>

                <div className="space-y-6 relative">
                  <div>
                    <h5 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-4 flex items-center gap-2">
                      <Activity size={12} className="text-yellow-500/50" /> 
                      Active_Neural_Chips
                    </h5>
                    <div className="flex flex-wrap gap-2">
                      {agent.tools.map(toolName => {
                        const tool = allTools.find(t => t.name === toolName);
                        const isUniversal = universalSkills.includes(toolName);
                        const isExternal = tool?.isExternal;

                        return (
                          <div 
                            key={toolName} 
                            className={`group flex items-center gap-3 pl-4 pr-2 py-2 border transition-all ${
                              isUniversal 
                                ? 'bg-blue-500/5 border-blue-500/20 text-blue-400' 
                                : isExternal
                                ? 'bg-purple-500/5 border-purple-500/20 text-purple-400'
                                : 'bg-yellow-500/5 border-yellow-500/20 text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.02)]'
                            }`}
                          >
                            <span className="text-[10px] font-black uppercase tracking-widest">
                              {toolName}
                              {isUniversal && <span className="ml-2 text-[8px] opacity-40">(CORE)</span>}
                              {isExternal && <span className="ml-2 text-[8px] opacity-40">(EXTERNAL)</span>}
                            </span>
                            <button
                              onClick={() => handleToggleTool(agent.id, toolName)}
                              disabled={isPending || isUniversal}
                              className={`p-1 transition-all rounded-sm ${
                                isUniversal 
                                  ? 'opacity-20 cursor-not-allowed' 
                                  : 'hover:bg-red-500 hover:text-white opacity-40 group-hover:opacity-100'
                              }`}
                              title={isUniversal ? "Universal Core Skill" : "Remove Tool"}
                            >
                              <X size={10} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-6 border-t border-white/5">
                    <h5 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-4 flex items-center gap-2">
                      <Plus size={12} className="text-yellow-500/50" /> 
                      Available_Insertions
                    </h5>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {allTools
                        .filter(t => !agent.tools.includes(t.name))
                        .filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.description.toLowerCase().includes(searchQuery.toLowerCase()))
                        .map(tool => (
                          <button
                            key={tool.name}
                            onClick={() => handleToggleTool(agent.id, tool.name)}
                            disabled={isPending}
                            className={`flex flex-col items-start text-left p-3 rounded-sm border transition-all group/item ${
                              tool.isExternal 
                                ? 'border-purple-500/10 bg-purple-500/[0.02] hover:bg-purple-500/10 hover:border-purple-500/30'
                                : 'border-white/5 bg-white/[0.02] hover:bg-yellow-500/10 hover:border-yellow-500/30'
                            }`}
                          >
                            <div className="flex justify-between items-center w-full mb-1">
                              <span className={`text-[10px] font-black uppercase tracking-widest transition-colors ${
                                tool.isExternal ? 'text-purple-400/60 group-hover/item:text-purple-400' : 'text-white/60 group-hover/item:text-yellow-500'
                              }`}>
                                {tool.name}
                              </span>
                              <Plus size={10} className={`${tool.isExternal ? 'text-purple-400/20 group-hover/item:text-purple-400' : 'text-white/20 group-hover/item:text-yellow-500'}`} />
                            </div>
                            <p className="text-[8px] text-white/20 leading-tight line-clamp-2 uppercase tracking-tighter">
                              {tool.description}
                            </p>
                          </button>
                        ))
                      }
                      {allTools.filter(t => !agent.tools.includes(t.name)).length === 0 && (
                        <div className="col-span-full py-4 text-center border border-dashed border-white/5 rounded-sm">
                           <span className="text-[8px] text-white/10 uppercase tracking-[0.3em]">Full_Potential_Reached</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'library' && (
        <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredTools.map(tool => (
                <div key={tool.name} className={`glass-card p-6 border-white/5 flex flex-col justify-between hover:border-yellow-500/20 transition-all ${tool.isExternal ? 'border-purple-500/10' : ''}`}>
                  <div className="space-y-4">
                    <div className="flex justify-between items-start">
                      <div className="flex flex-col gap-1">
                        <span className={`text-[12px] font-black uppercase tracking-widest ${tool.isExternal ? 'text-purple-400' : 'text-yellow-500'}`}>
                          {tool.name}
                        </span>
                        {tool.isExternal && <span className="text-[7px] font-bold text-purple-400/40 uppercase tracking-tighter">EXTERNAL_MCP_BRIDGE</span>}
                      </div>
                      {tool.usage && tool.usage.count > 0 && (
                        <div className="flex items-center gap-1 text-white/20">
                          <Activity size={10} />
                          <span className="text-[9px] font-bold">{tool.usage.count}</span>
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-white/40 leading-relaxed uppercase tracking-widest">
                      {tool.description}
                    </p>
                  </div>
                  
                  {tool.usage && tool.usage.lastUsed > 0 && (
                    <div className="mt-6 pt-4 border-t border-white/5">
                      <span className="text-[8px] text-white/10 uppercase tracking-[0.2em]">
                        LAST_INVOCATION: {new Date(tool.usage.lastUsed).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              ))}
           </div>
        </section>
      )}
    </div>
  );
}
