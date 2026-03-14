'use client';

import React, { useState, useTransition, useEffect } from 'react';
import { 
  Wrench, Search, Trash2, X, Plus, 
  Activity, BookOpen, ExternalLink, Globe, Loader2, Zap, Cpu, Settings 
} from 'lucide-react';
import { updateAgentTools, deleteMCPServer, registerMCPServer } from '../app/capabilities/actions';
import { toast } from 'sonner';
import CyberConfirm from './CyberConfirm';
import { useRouter } from 'next/navigation';
import Button from './ui/Button';
import Typography from './ui/Typography';
import Card from './ui/Card';
import Badge from './ui/Badge';
import type { Tool } from '@/lib/types/ui';

interface AgentConfig {
  id: string;
  name: string;
  tools: string[];
  usage?: Record<string, { count: number; lastUsed: number }>;
}

interface CapabilitiesViewProps {
  allTools: Tool[];
  mcpServers: Record<string, any>;
  agents: AgentConfig[];
}

export default function CapabilitiesView({ allTools, mcpServers, agents }: CapabilitiesViewProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'agents' | 'library' | 'analytics' | 'mcp'>('analytics');
  const [isPending, startTransition] = useTransition();
  const [optimisticAgents, setOptimisticAgents] = useState(agents);
  const [newBridge, setNewBridge] = useState({ name: '', command: '', env: '{}' });
  const [selectedTool, setSelectedTool] = useState<typeof allTools[0] | null>(null);

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
  useEffect(() => {
    setOptimisticAgents(agents);
  }, [agents]);

  const sortedByUsage = [...allTools].sort((a, b) => (b.usage?.count || 0) - (a.usage?.count || 0));
  const totalInvocations = allTools.reduce((acc, t) => acc + (t.usage?.count || 0), 0);

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
        setOptimisticAgents(agents);
      }
    });
  };

  const handleDetachTool = (agentId: string, toolName: string) => {
    handleToggleTool(agentId, toolName);
  };

  const handleRemoveMCPServer = (name: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Bridge Deactivation',
      message: `You are about to unregister the skill bridge '${name}'. All associated tools will be removed from the system. Proceed?`,
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        startTransition(async () => {
          const result = await deleteMCPServer(name);
          if (result?.error) {
            toast.error(`Failed to deactivate bridge: ${result.error}`);
          } else {
            toast.success(`Skill bridge '${name}' deactivated`);
            router.refresh();
          }
        });
      }
    });
  };

  const handleAddBridge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBridge.name || !newBridge.command) {
      toast.error('Bridge name and command are mandatory');
      return;
    }

    startTransition(async () => {
      const result = await registerMCPServer(newBridge.name, newBridge.command, newBridge.env);
      if (result?.error) {
        toast.error(`Registration failed: ${result.error}`);
      } else {
        toast.success(`Neural bridge '${newBridge.name}' established`);
        setNewBridge({ name: '', command: '', env: '{}' });
        router.refresh();
      }
    });
  };

  const universalSkills = ['discoverSkills', 'installSkill'];

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

    // Optimistic update
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
        setOptimisticAgents(agents); // Rollback
      }
    });
  };

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
          <Card variant="glass" padding="lg" className="flex flex-col items-center gap-6 border-cyber-blue/20 shadow-[0_0_50px_rgba(0,224,255,0.1)]">
            <Loader2 size={48} className="text-cyber-blue animate-spin" />
            <div className="space-y-2 text-center">
               <Typography variant="caption" weight="black" color="intel" className="tracking-[0.5em] block">Synchronizing Neural Network...</Typography>
              <Typography variant="mono" color="muted" className="tracking-[0.3em] block text-[8px]">Rewriting cognitive pathways</Typography>
            </div>
          </Card>
        </div>
      )}

      {/* Navigation & Search */}
      <div className="flex flex-col lg:flex-row gap-6 justify-between items-start lg:items-center sticky top-0 z-20 bg-black/90 backdrop-blur-xl p-6 border-b border-white/5 -mx-6 lg:-mx-10 -mt-10 mb-10">
        <nav className="flex gap-1 bg-white/5 p-1 rounded-sm border border-white/5">
          {[
            { id: 'agents', label: 'Tool Assignments', icon: Cpu },
            { id: 'analytics', label: 'Tool Analytics', icon: Activity },
            { id: 'library', label: 'Capability Library', icon: BookOpen },
            { id: 'mcp', label: 'Skill Bridges', icon: ExternalLink },
          ].map(tab => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab(tab.id as any)}
              icon={<tab.icon size={12} />}
              className={`px-6 font-black tracking-widest transition-all ${
                activeTab === tab.id 
                  ? 'shadow-[0_0_20px_rgba(0,224,255,0.2)]' 
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              {tab.label}
            </Button>
          ))}
        </nav>

        <div className="relative flex-1 max-w-xl group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search size={16} className="text-cyber-blue/50" />
          </div>
          <input
            type="text"
            placeholder="Search current capabilities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-black/60 border border-white/10 focus:border-cyber-blue/40 rounded-sm py-3 pl-12 pr-4 text-[10px] outline-none transition-all placeholder:text-white/20 font-mono tracking-widest"
          />
          {searchQuery && (
            <div className="absolute top-full left-0 right-0 mt-2 p-4 glass-card border-cyber-blue/20 animate-in slide-in-from-top-2 duration-300 z-30 shadow-2xl">
               <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-[9px] text-white/40 uppercase tracking-widest font-bold">
                    <Globe size={12} className="text-cyber-blue" />
                    Cannot find what you need?
                  </div>
                  <button 
                    onClick={() => window.location.href = `/?prompt=Discover new tools for ${searchQuery}`}
                    className="text-[9px] font-black text-cyber-blue hover:text-cyber-blue/80 transition-colors tracking-tighter flex items-center gap-1"
                  >
                    Trigger global discovery <ExternalLink size={10} />
                  </button>
               </div>
            </div>
          )}
        </div>
      </div>

      {activeTab === 'analytics' && (
        <section className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Global Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card variant="glass" padding="lg" className="border-cyber-blue/20">
              <Typography variant="mono" color="muted" className="text-[10px] tracking-widest opacity-40 mb-2 block">Total neural invocations</Typography>
              <Typography variant="h2" color="white" weight="black" glow className="text-4xl tracking-tighter">{totalInvocations}</Typography>
            </Card>
            <Card variant="glass" padding="lg" className="border-cyber-green/20">
              <Typography variant="mono" color="muted" className="text-[10px] tracking-widest opacity-40 mb-2 block">Most active skill</Typography>
              <Typography variant="h2" color="primary" weight="black" className="text-xl truncate tracking-tight">{sortedByUsage[0]?.name || 'N/A'}</Typography>
            </Card>
            <Card variant="glass" padding="lg" className="border-purple-500/20">
              <Typography variant="mono" color="muted" className="text-[10px] tracking-widest opacity-40 mb-2 block">Bridge efficiency</Typography>
              <Typography variant="h2" color="white" weight="black" className="text-4xl tracking-tighter">{allTools.filter(t => t.isExternal && (t.usage?.count || 0) > 0).length} / {allTools.filter(t => t.isExternal).length}</Typography>
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
            {/* Per-Agent Usage & Pruning */}
            <div className="xl:col-span-12 space-y-6">
              <h4 className="text-[12px] font-black uppercase tracking-[0.4em] text-white/40 flex items-center gap-2">
                <Activity size={16} className="text-cyber-blue" /> Per-agent efficiency audit
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {optimisticAgents.filter(a => a.id !== 'monitor' && a.id !== 'events').map(agent => {
                  const agentUsage = agent.usage || {};
                  const neverUsedTools = agent.tools.filter(t => !agentUsage[t]);
                  const lowUsageTools = agent.tools
                    .filter(t => agentUsage[t] && agentUsage[t].count < 3)
                    .sort((a, b) => (agentUsage[a]?.count || 0) - (agentUsage[b]?.count || 0));

                  return (
                    <Card key={agent.id} variant="glass" padding="lg" className="border-white/5 bg-black/40">
                      <div className="flex justify-between items-start mb-6 border-b border-white/5 pb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded bg-cyber-blue/10 flex items-center justify-center text-cyber-blue border border-cyber-blue/20 shadow-[0_0_15px_rgba(0,224,255,0.1)]">
                            {agent.id === 'main' ? <Zap size={16} /> : <Cpu size={16} />}
                          </div>
                          <Typography variant="body" weight="black" color="white" className="tracking-widest capitalize">{agent.name}</Typography>
                        </div>
                        <Badge variant="outline" className="text-[8px] opacity-40">Efficiency: {Math.round((agent.tools.length - neverUsedTools.length) / (agent.tools.length || 1) * 100)}%</Badge>
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

            {/* Total Leaderboard */}
            <div className="xl:col-span-12 space-y-6 pt-10">
              <h4 className="text-[12px] font-black uppercase tracking-[0.4em] text-white/40 flex items-center gap-2">
                <Activity size={16} className="text-cyber-blue" /> Total neural invocations
              </h4>
              <Card variant="solid" className="border-white/5 bg-black/40 overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.02]">
                      <th className="p-4 text-[10px] font-black tracking-widest text-white/40">Capability</th>
                      <th className="p-4 text-[10px] font-black tracking-widest text-white/40">Total invocations</th>
                      <th className="p-4 text-[10px] font-black tracking-widest text-white/40">Last active</th>
                      <th className="p-4 text-[10px] font-black tracking-widest text-white/40">Attached nodes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedByUsage
                      .filter(t => (t.usage?.count || 0) > 0)
                      .filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.description.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map(tool => {
                        const attachedAgents = optimisticAgents.filter(a => a.tools.includes(tool.name));
                        return (
                          <tr key={tool.name} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group">
                            <td className="p-4">
                              <div className="flex flex-col">
                                <span className={`text-xs font-black tracking-wider ${tool.isExternal ? 'text-purple-400' : 'text-yellow-500'}`}>{tool.name}</span>
                                {tool.isExternal && <span className="text-[8px] opacity-30 font-bold">External bridge</span>}
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 bg-white/5 rounded-full flex-1 max-w-[100px] overflow-hidden">
                                  <div 
                                    className={`h-full ${tool.isExternal ? 'bg-purple-500' : 'bg-yellow-500'}`} 
                                    style={{ width: `${Math.min(100, (tool.usage?.count || 0) / (sortedByUsage[0]?.usage?.count || 1) * 100)}%` }}
                                  />
                                </div>
                                <span className="text-xs font-mono font-bold text-white/80">{tool.usage?.count}</span>
                              </div>
                            </td>
                            <td className="p-4">
                              <span className="text-[10px] font-mono text-white/40">{tool.usage?.lastUsed ? new Date(tool.usage.lastUsed).toLocaleTimeString() : 'NEVER'}</span>
                            </td>
                            <td className="p-4">
                              <div className="flex -space-x-2">
                                {attachedAgents.map(a => (
                                  <div key={a.id} title={a.name} className="w-6 h-6 rounded-full bg-cyber-blue/20 border border-cyber-blue/40 flex items-center justify-center text-[8px] font-black text-cyber-blue ring-2 ring-black">
                                    {a.name.substring(0, 1)}
                                  </div>
                                ))}
                                {attachedAgents.length === 0 && <span className="text-[10px] text-white/10 italic">Unassigned</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'agents' && (
        <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 gap-8">
            {optimisticAgents.map(agent => (
              <Card variant="glass" padding="lg" key={agent.id} className="cyber-border border-yellow-500/10 hover:border-yellow-500/20 transition-all relative overflow-hidden">
                <div className="absolute top-0 right-0 p-2 opacity-5">
                   <Zap size={120} className="text-yellow-500" />
                </div>
                
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 relative">
                  <div className="flex items-center gap-5">
                    <div className="w-14 h-14 rounded-sm bg-yellow-500/10 flex items-center justify-center text-yellow-500 border border-yellow-500/20 shadow-[0_0_30px_rgba(234,179,8,0.1)]">
                       {agent.id === 'main' ? <Zap size={28} /> : agent.id === 'coder' ? <Cpu size={28} /> : <Settings size={28} />}
                    </div>
                    <div>
                      <Typography variant="h3" weight="black" color="primary" className="tracking-[0.3em] mb-1">
                        {agent.name}
                      </Typography>
                      <Typography variant="caption" color="muted" className="tracking-widest max-w-xl block leading-relaxed">
                        Neural core node: Configured for specialized operations.
                      </Typography>
                    </div>
                  </div>
                  
                  <div className="flex gap-3">
                    <Badge variant="outline" className="px-4 py-2 border-white/5 text-white/20 font-bold tracking-widest">
                      {agent.tools.length} active tools
                    </Badge>
                  </div>
                </div>

                <div className="space-y-6 relative border-t border-white/5 pt-8">
                  <div>
                    <h5 className="text-[10px] font-black tracking-[0.3em] text-white/40 mb-4 flex items-center gap-2">
                      <Activity size={12} className="text-yellow-500/50" /> 
                      Active neural tools
                    </h5>
                    <div className="flex flex-wrap gap-2">
                      {agent.tools.map(toolName => {
                        const tool = allTools.find(t => t.name === toolName);
                        if (searchQuery && !toolName.toLowerCase().includes(searchQuery.toLowerCase()) && !tool?.description.toLowerCase().includes(searchQuery.toLowerCase())) return null;
                        
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
                            <span className="text-[10px] font-black tracking-widest">
                              {toolName}
                              {isUniversal && <span className="ml-2 text-[8px] opacity-40">(Core)</span>}
                              {isExternal && <span className="ml-2 text-[8px] opacity-40">(External)</span>}
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
                    <h5 className="text-[10px] font-black tracking-[0.3em] text-white/40 mb-4 flex items-center gap-2">
                      <Plus size={12} className="text-yellow-500/50" /> 
                      Available insertions
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
                              <span className={`text-[10px] font-black tracking-widest transition-colors ${
                                tool.isExternal ? 'text-purple-400/60 group-hover/item:text-purple-400' : 'text-white/60 group-hover/item:text-yellow-500'
                              }`}>
                                {tool.name}
                              </span>
                              <Plus size={10} className={`${tool.isExternal ? 'text-purple-400/20 group-hover/item:text-purple-400' : 'text-white/20 group-hover/item:text-yellow-500'}`} />
                            </div>
                            <p className="text-[8px] text-white/20 leading-tight line-clamp-2 tracking-tighter">
                              {tool.description}
                            </p>
                          </button>
                        ))
                      }
                      {allTools.filter(t => !agent.tools.includes(t.name)).length === 0 && (
                        <div className="col-span-full py-4 text-center border border-dashed border-white/5 rounded-sm">
                           <span className="text-[8px] text-white/10 tracking-[0.3em]">Full potential reached</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'mcp' && (
        <section className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* New Bridge Form */}
          <Card variant="glass" padding="lg" className="border-cyber-blue/10 bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
            <h4 className="text-[12px] font-black tracking-[0.4em] text-cyber-blue/80 mb-6 flex items-center gap-2">
              <Plus size={16} /> Establish new bridge
            </h4>
            <form onSubmit={handleAddBridge} className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Typography variant="mono" weight="bold" color="muted" className="text-[9px] tracking-widest ml-1">Bridge identifier</Typography>
                <input 
                  type="text" 
                  placeholder="e.g. brave-search"
                  value={newBridge.name}
                  onChange={e => setNewBridge({...newBridge, name: e.target.value})}
                  className="w-full bg-black/60 border border-white/10 focus:border-cyber-blue/40 rounded-sm p-3 text-[10px] font-mono outline-none text-white/80 transition-all"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Typography variant="mono" weight="bold" color="muted" className="text-[9px] tracking-widest ml-1">Activation command</Typography>
                <input 
                  type="text" 
                  placeholder="npx -y @modelcontextprotocol/server-brave-search"
                  value={newBridge.command}
                  onChange={e => setNewBridge({...newBridge, command: e.target.value})}
                  className="w-full bg-black/60 border border-white/10 focus:border-cyber-blue/40 rounded-sm p-3 text-[10px] font-mono outline-none text-white/80 transition-all"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Typography variant="mono" weight="bold" color="muted" className="text-[9px] tracking-widest ml-1">Environment variables (JSON)</Typography>
                <textarea 
                  placeholder='{ "BRAVE_API_KEY": "..." }'
                  value={newBridge.env}
                  onChange={e => setNewBridge({...newBridge, env: e.target.value})}
                  rows={1}
                  className="w-full bg-black/60 border border-white/10 focus:border-cyber-blue/40 rounded-sm p-3 text-[10px] font-mono outline-none text-white/80 transition-all resize-none"
                />
              </div>
              <div className="flex items-end">
                <Button 
                  type="submit"
                  disabled={isPending}
                  variant="primary"
                  className="w-full h-[46px] shadow-[0_0_30px_rgba(0,224,255,0.1)]"
                  icon={isPending ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                >
                  Initiate bridge
                </Button>
              </div>
            </form>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Object.entries(mcpServers)
                .filter(([name, config]) => {
                  if (!searchQuery) return true;
                  const query = searchQuery.toLowerCase();
                  const cmd = typeof config === 'string' ? config : config.command;
                  return name.toLowerCase().includes(query) || cmd.toLowerCase().includes(query);
                })
                .map(([name, config]) => (
                  <Card variant="glass" padding="md" key={name} className="group hover:border-red-500/20 transition-all relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-cyber-blue/5 blur-3xl -mr-16 -mt-16 pointer-events-none" />
                      <div className="flex justify-between items-start mb-6 relative">
                          <div>
                            <Typography variant="body" weight="black" color="white" className="tracking-[0.2em] mb-1">{name}</Typography>
                            <Badge variant="primary" className="bg-cyber-blue/10 text-cyber-blue/60 font-bold">
                                Bridge active
                            </Badge>
                          </div>
                          <Button 
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveMCPServer(name)}
                              className="opacity-0 group-hover:opacity-100 border border-white/10 hover:bg-red-500 hover:text-white p-2"
                              icon={<Trash2 size={14} />}
                          />
                      </div>
                      <div className="space-y-4 relative">
                          <p className="text-[10px] font-mono text-white/40 break-all bg-black/60 p-3 rounded-sm border border-white/5 leading-relaxed">
                              {typeof config === 'string' ? config : config.command}
                          </p>
                          {typeof config !== 'string' && config.env && (
                              <div className="flex flex-wrap gap-2">
                                  {Object.keys(config.env).map(key => (
                                    <Badge key={key} variant="primary" className="border-cyber-blue/20 text-cyber-blue/60 font-bold py-0 text-[8px]">
                                        {key}
                                    </Badge>
                                  ))}
                              </div>
                          )}
                      </div>
                  </Card>
              ))}
              {Object.keys(mcpServers).length === 0 && (
                  <Card variant="solid" padding="lg" className="col-span-full py-20 text-center border-dashed border-white/10">
                      <Typography variant="caption" color="muted" uppercase className="tracking-[0.5em]">No active skill bridges detected.</Typography>
                  </Card>
              )}
          </div>
        </section>
      )}

      {activeTab === 'library' && (
        <section className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {(() => {
              // Group tools by their prefix or source
              const groups: Record<string, typeof filteredTools> = {};
              filteredTools.forEach(tool => {
                let group = 'CORE_UNIFIED';
                if (tool.isExternal) {
                  const parts = tool.name.split('_');
                  group = parts.length > 1 ? parts[0] : 'EXTERNAL_MISC';
                } else if (tool.name.includes('_')) {
                    group = tool.name.split('_')[0];
                }
                
                if (!groups[group]) groups[group] = [];
                groups[group].push(tool);
              });

              return Object.entries(groups).map(([groupName, groupTools]) => (
                <div key={groupName} className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="h-px flex-1 bg-white/5"></div>
                    <h3 className="text-[10px] font-black tracking-[0.5em] text-cyber-blue flex items-center gap-2">
                       <Cpu size={14} className="opacity-50" /> {groupName} Subsystem
                    </h3>
                    <div className="h-px flex-1 bg-white/5"></div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    {groupTools.map(tool => (
                      <button 
                        key={tool.name} 
                        onClick={() => setSelectedTool(tool)}
                        className={`group p-4 glass-card border-white/5 hover:border-cyber-blue/20 transition-all flex flex-col justify-between min-h-[100px] text-left ${tool.isExternal ? 'border-purple-500/10' : ''}`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <Typography variant="mono" weight="black" className={`text-[10px] tracking-wider ${tool.isExternal ? 'text-purple-400' : 'text-cyber-blue'}`}>
                            {tool.name.includes('_') ? tool.name.split('_').slice(1).join('_') : tool.name}
                          </Typography>
                          {tool.usage && tool.usage.count > 0 && (
                            <div className="px-1.5 py-0.5 bg-white/5 rounded text-[8px] font-bold text-white/40">
                              {tool.usage.count}
                            </div>
                          )}
                        </div>
                        <Typography variant="caption" className="text-[9px] text-white/40 tracking-tighter leading-tight line-clamp-2">
                          {tool.description}
                        </Typography>
                        
                        <div className="mt-3 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                           <span className="text-[7px] text-white/20 font-mono tracking-widest">Configure access</span>
                           <Settings size={10} className="text-white/20" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ));
            })()}
        </section>
      )}
      {/* Selection Modal */}
      {selectedTool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="w-full max-w-2xl glass-card border-white/10 overflow-hidden animate-in zoom-in-95 duration-300 shadow-2xl">
            <div className="p-8 border-b border-white/5 flex justify-between items-start bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-cyber-blue/10 via-transparent to-transparent">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                    <Typography variant="h3" weight="black" color="white" glow className="tracking-[0.2em]">{selectedTool.name}</Typography>
                    {selectedTool.isExternal && <Badge variant="primary" className="bg-purple-500/10 text-purple-400 font-bold border-purple-500/20 py-0.5">Neural bridge</Badge>}
                </div>
                <Typography variant="body" color="muted" className="text-[10px] tracking-widest leading-relaxed max-w-lg block">
                  {selectedTool.description}
                </Typography>
              </div>
              <button 
                onClick={() => setSelectedTool(null)}
                className="p-2 bg-white/5 hover:bg-white/10 rounded-sm text-white/40 hover:text-white transition-colors border border-white/5"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-8">
              <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/20 flex items-center gap-2">
                  <Cpu size={14} /> Agent_Connectivity_Registry
                </h4>
                
                <div className="space-y-3">
                  {optimisticAgents.filter(a => a.id !== 'monitor' && a.id !== 'events').map(agent => {
                    const isAttached = agent.tools.includes(selectedTool.name);
                    const isUniversal = universalSkills.includes(selectedTool.name);
                    
                    return (
                      <div key={agent.id} className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-sm group hover:border-white/10 transition-all">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded bg-white/5 flex items-center justify-center border border-white/5 transition-colors ${isAttached ? 'border-cyber-blue/30 text-cyber-blue bg-cyber-blue/5' : 'text-white/20'}`}>
                            {agent.id === 'main' ? <Zap size={18} /> : <Cpu size={18} />}
                          </div>
                          <div>
                            <Typography variant="body" weight="black" color="white" className="uppercase tracking-widest">{agent.name}</Typography>
                            <Typography variant="caption" className="text-[8px] text-white/20 uppercase tracking-widest block font-mono">ID: {agent.id}</Typography>
                          </div>
                        </div>
                        
                        <Button 
                          variant={isAttached ? 'primary' : 'ghost'}
                          size="sm"
                          disabled={isPending || isUniversal}
                          onClick={() => handleToggleToolAssignment(agent.id, selectedTool.name, isAttached)}
                          className={`min-w-[120px] font-black tracking-widest text-[9px] transition-all duration-300 relative group/btn ${
                            isAttached 
                              ? 'bg-cyber-blue/80 hover:bg-red-500/80 hover:border-red-500 shadow-[0_0_15px_rgba(0,224,255,0.2)]' 
                              : 'border-white/10 text-white/40 hover:text-white hover:border-cyber-blue/40'
                          }`}
                          icon={
                            isPending ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <div className="relative w-3 h-3">
                                <span className="absolute inset-0 transition-opacity duration-300 group-hover/btn:opacity-0 flex items-center justify-center">
                                  {isAttached ? <Zap size={12} strokeWidth={3} /> : <Plus size={12} />}
                                </span>
                                <span className="absolute inset-0 transition-opacity duration-300 opacity-0 group-hover/btn:opacity-100 flex items-center justify-center">
                                  {isAttached ? <X size={12} strokeWidth={3} /> : <Zap size={12} strokeWidth={3} />}
                                </span>
                              </div>
                            )
                          }
                        >
                          <span className="group-hover/btn:hidden">
                            {isAttached ? 'Attached' : 'Unassigned'}
                          </span>
                          <span className="hidden group-hover/btn:inline">
                            {isAttached ? 'Detach' : 'Assign'}
                          </span>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-4 bg-white/[0.02] border-t border-white/5 text-center">
               <Typography variant="mono" color="muted" className="text-[8px] tracking-[0.3em] opacity-30">
                 [Secure access granted] - Tool assignments are live-synced to the neural core.
               </Typography>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
