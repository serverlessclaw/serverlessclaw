'use client';

import React, { useState, useEffect } from 'react';
import { Bot, Save, Plus, Trash2, Shield, Settings2, RefreshCw, Cpu, ChevronRight, ShieldAlert, X, Wrench } from 'lucide-react';
import Link from 'next/link';
import CyberSelect from '@/components/CyberSelect';
import { THEME } from '@/lib/theme';
import { toast } from 'sonner';
import CyberConfirm from '@/components/CyberConfirm';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

interface AgentConfig {
  id: string;
  name: string;
  systemPrompt: string;
  provider?: string;
  model?: string;
  enabled: boolean;
  isBackbone?: boolean;
}

const PROVIDERS = {
  openai: {
    label: 'OpenAI (Native)',
    models: ['gpt-5.4', 'gpt-5-mini'],
  },
  bedrock: {
    label: 'AWS Bedrock (Native)',
    models: ['global.anthropic.claude-sonnet-4-6'],
  },
  openrouter: {
    label: 'OpenRouter (Aggregator)',
    models: ['zhipu/glm-5', 'minimax/minimax-2.5', 'google/gemini-3-flash-preview'],
  },
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Record<string, AgentConfig>>({});
  const [initialAgents, setInitialAgents] = useState<Record<string, AgentConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showBackboneWarning, setShowBackboneWarning] = useState(false);
  const [backboneChanges, setBackboneChanges] = useState<string[]>([]);
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  const [newAgent, setNewAgent] = useState<Partial<AgentConfig>>({
    name: '',
    id: '',
    systemPrompt: '',
    enabled: true,
    isBackbone: false,
  });

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    agentId: string;
    agentName: string;
  }>({
    isOpen: false,
    agentId: '',
    agentName: '',
  });

  useEffect(() => {
    fetch('/api/agents')
      .then((res) => res.json())
      .then((data) => {
        setAgents(data);
        setInitialAgents(JSON.parse(JSON.stringify(data)));
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load agents:', err);
        setLoading(false);
      });
  }, []);

  const handleSave = async (force: boolean = false) => {
    // Detect backbone changes
    if (!force) {
      const changedBackbone = Object.values(agents).filter(agent => {
        if (!agent.isBackbone) return false;
        const initial = initialAgents[agent.id];
        if (!initial) return false;
        return (
          agent.name !== initial.name ||
          agent.systemPrompt !== initial.systemPrompt ||
          agent.model !== initial.model ||
          agent.provider !== initial.provider ||
          agent.enabled !== initial.enabled
        );
      }).map(a => a.name || a.id);

      if (changedBackbone.length > 0) {
        setBackboneChanges(changedBackbone);
        setShowBackboneWarning(true);
        return;
      }
    }

    setSaving(true);
    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agents),
      });
      if (!response.ok) throw new Error('Failed to save');
      setInitialAgents(JSON.parse(JSON.stringify(agents)));
      toast.success('Agent configurations synchronized successfully');
      setShowBackboneWarning(false);
    } catch (err) {
      toast.error('Failed to save agent configuration');
    } finally {
      setSaving(false);
    }
  };

  const updateAgent = (id: string, updates: Partial<AgentConfig>) => {
    setAgents((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...updates },
    }));
  };

  const addAgent = () => {
    setShowNewAgentModal(true);
    setNewAgent({
      name: 'New Specialized Agent',
      id: `agent_${Date.now()}`,
      systemPrompt: 'You are a specialized agent that...',
      enabled: true,
      isBackbone: false,
    });
  };

  const finalizeNewAgent = () => {
    if (!newAgent.id || !newAgent.name) {
        toast.error('Agent ID and Name are required.');
        return;
    }
    
    setAgents((prev) => ({
      ...prev,
      [newAgent.id!]: newAgent as AgentConfig,
    }));
    setShowNewAgentModal(false);
  };

  const deleteAgent = (id: string) => {
    if (agents[id].isBackbone) return;
    setConfirmModal({
      isOpen: true,
      agentId: id,
      agentName: agents[id].name,
    });
  };

  const executeDeleteAgent = () => {
    const id = confirmModal.agentId;
    const next = { ...agents };
    delete next[id];
    setAgents(next);
    setConfirmModal({ isOpen: false, agentId: '', agentName: '' });
    toast.success(`Agent '${confirmModal.agentName}' decommissioned`);
  };

  const hasChanges = JSON.stringify(agents) !== JSON.stringify(initialAgents);

  if (loading)
    return (
      <main className="flex-1 p-10 flex items-center justify-center text-white/40">
        <Typography variant="mono" color="intel" uppercase className="flex items-center gap-3 animate-pulse">
          <RefreshCw className="animate-spin" size={20} /> Initializing Agent Manager...
        </Typography>
      </main>
    );

  return (
    <main className={`flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-${THEME.COLORS.INTEL}/5 via-transparent to-transparent`}>
      <CyberConfirm 
        isOpen={confirmModal.isOpen}
        title="Agent Decommissioning"
        message={`Are you sure you want to decommission specialized agent '${confirmModal.agentName}'? This will remove it from the system.`}
        variant="danger"
        onConfirm={executeDeleteAgent}
        onCancel={() => setConfirmModal({ isOpen: false, agentId: '', agentName: '' })}
      />
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <Typography variant="h1" color="white" glow uppercase>
            Agents
          </Typography>
          <Typography variant="body" color="muted" className="mt-2 block">
            Manage backbone orchestrators and specialized autonomous agents.
          </Typography>
        </div>
        <Button
          onClick={addAgent}
          variant="outline"
          size="sm"
          icon={<Plus size={14} />}
          uppercase
        >
          New Agent
        </Button>
      </header>

      <div className="max-w-6xl space-y-8 pb-20">
        <div className="grid grid-cols-1 gap-6">
          {Object.values(agents).map((agent) => {
            const isLogicOnly = agent.id === 'monitor' || agent.id === 'recovery' || agent.id === 'events';
            
            return (
              <Card
                key={agent.id}
                variant="glass"
                padding="md"
                className={`border-l-2 transition-all ${
                  agent.isBackbone
                    ? `border-${THEME.COLORS.INTEL} shadow-[0_0_20px_rgba(0,224,255,0.05)]`
                    : 'border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-6">
                  <div className="flex items-center gap-4">
                    <div
                      className={`p-3 rounded-sm ${
                        agent.isBackbone
                          ? `bg-${THEME.COLORS.INTEL}/20 text-${THEME.COLORS.INTEL}`
                          : 'bg-white/5 text-white/100'
                      }`}
                    >
                      {isLogicOnly ? <ShieldAlert size={20} /> : (agent.isBackbone ? <Shield size={20} /> : <Bot size={20} />)}
                    </div>
                    <div>
                      <input
                        value={agent.name}
                        onChange={(e) => updateAgent(agent.id, { name: e.target.value })}
                        className="bg-transparent border-none text-white font-bold outline-none focus:ring-1 focus:ring-white/20 rounded px-1 text-base uppercase tracking-tight"
                        placeholder="Agent Name"
                      />
                      <div className="text-[10px] text-white/50 mt-1 font-mono flex items-center gap-2">
                        {agent.id} 
                        {agent.isBackbone && <Badge variant="primary" className="py-0">Backbone Protected</Badge>}
                        {isLogicOnly && <Badge variant="primary" className="bg-yellow-500/10 text-yellow-500 py-0">System Logic Only</Badge>}
                      </div>
                    </div>
                  </div>

                    <div className="flex items-center gap-3 self-end lg:self-center">
                      <Link href="/capabilities">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-white/50 hover:text-[var(--cyber-green)] p-2 h-auto flex items-center gap-2"
                        >
                          <Wrench size={14} />
                          <span className="text-[10px] font-bold uppercase tracking-widest">Capabilities</span>
                        </Button>
                      </Link>
                      <label className={`flex items-center gap-3 ${agent.isBackbone ? 'cursor-not-allowed' : 'cursor-pointer'} group`}>
                      <Typography variant="caption" weight="bold" color="white" uppercase className="group-hover:text-cyber-green transition-colors">Active Status</Typography>
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={agent.enabled}
                          disabled={agent.isBackbone}
                          onChange={(e) => updateAgent(agent.id, { enabled: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className={`w-10 h-5 bg-white/10 rounded-full peer peer-checked:bg-${THEME.COLORS.PRIMARY}/40 relative transition-all border border-white/5 overflow-hidden ${agent.isBackbone ? 'opacity-50 grayscale-[0.5]' : ''} after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white/20 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:toggle-move peer-checked:after:bg-${THEME.COLORS.PRIMARY} shadow-inner`}></div>
                      </div>
                      {agent.isBackbone && <Typography variant="mono" color="muted" className="text-[8px]" uppercase>Read Only</Typography>}
                    </label>
                    {!agent.isBackbone && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteAgent(agent.id)}
                        className="text-white/50 hover:text-red-500 p-2 h-auto"
                        icon={<Trash2 size={16} />}
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Prompt Section */}
                  <div className="lg:col-span-7 space-y-3">
                    <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center gap-2">
                      <Settings2 size={12} className={`text-${THEME.COLORS.INTEL}`} /> 
                      {isLogicOnly ? 'Execution Parameters' : 'System Instructions (System Prompt)'}
                    </Typography>
                    <div className="relative">
                      {isLogicOnly ? (
                        <Card variant="solid" padding="md" className="w-full text-[10px] text-white/40 font-mono italic leading-relaxed min-h-[280px]">
                          This agent operates on deterministic system logic rather than autonomous reasoning. 
                          Instructions are hardcoded in the codebase for maximum reliability and safety.
                          <br /><br />
                          <Typography variant="mono" weight="bold" color="white" uppercase className="flex items-center gap-2 mt-4 opacity-60">
                            <ChevronRight size={10} /> source_path: core/handlers/{agent.id}.ts
                          </Typography>
                        </Card>
                      ) : (
                        <textarea
                          value={agent.systemPrompt}
                          onChange={(e) => updateAgent(agent.id, { systemPrompt: e.target.value })}
                          className={`w-full bg-black/40 border border-white/10 rounded p-4 text-xs text-white/90 font-mono min-h-[280px] outline-none focus:border-${THEME.COLORS.INTEL}/40 transition-all leading-relaxed custom-scrollbar`}
                          placeholder="Enter the system instructions for this agent..."
                        />
                      )}
                    </div>
                  </div>
                  {/* Model & Config Section */}
                  <div className="lg:col-span-5 space-y-6">
                    {!isLogicOnly && (
                      <Card variant="solid" padding="sm" className="space-y-4">
                        <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center gap-2">
                            <Cpu size={12} className={`text-${THEME.COLORS.PRIMARY}`} /> Hardware Alignment
                        </Typography>
                        
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Typography variant="mono" weight="bold" color="white" uppercase className="text-[9px] opacity-60">LLM Provider</Typography>
                            <CyberSelect
                              value={agent.provider || ''}
                              onChange={(val) => updateAgent(agent.id, { provider: val, model: '' })}
                              options={[
                                { value: '', label: 'INHERIT_SYSTEM_DEFAULT' },
                                ...Object.entries(PROVIDERS).map(([id, p]) => ({
                                  value: id,
                                  label: p.label,
                                })),
                              ]}
                              className="w-full"
                            />
                          </div>

                          <div className="space-y-2">
                            <Typography variant="mono" weight="bold" color="white" uppercase className="text-[9px] opacity-60">Model ID</Typography>
                            <CyberSelect
                              value={agent.model || ''}
                              onChange={(val) => updateAgent(agent.id, { model: val })}
                              options={
                                agent.provider
                                  ? PROVIDERS[agent.provider as keyof typeof PROVIDERS]?.models.map((m) => ({
                                      value: m,
                                      label: m,
                                    }))
                                  : []
                              }
                              disabled={!agent.provider}
                              placeholder={agent.provider ? 'SELECT_MODEL' : 'SELECT_PROVIDER_FIRST'}
                              className="w-full"
                            />
                          </div>
                        </div>
                      </Card>
                    )}

                    <Card variant="solid" padding="sm" className={`border-${THEME.COLORS.INTEL}/10 bg-${THEME.COLORS.INTEL}/[0.02]`}>
                      <Typography variant="caption" weight="bold" color="intel" uppercase className="flex items-center gap-2 mb-2">
                          <ChevronRight size={12} /> Execution Context
                      </Typography>
                      <Typography variant="caption" color="white" className="italic block opacity-70">
                          Agent Type: {agent.isBackbone ? 'PERSISTENT_BACKBONE' : 'DYNAMIC_SPOKE'}.
                          {isLogicOnly ? ' Core resilience logic.' : ' Authorized to interact with global bus and session memory.'}
                      </Typography>
                    </Card>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Floating Save Button */}
      <div className="fixed bottom-10 right-10 z-30">
        <Button
          onClick={() => handleSave()}
          disabled={saving || !hasChanges}
          loading={saving}
          size="lg"
          icon={<Save size={16} />}
          uppercase
          className="shadow-[0_0_20px_rgba(0,0,0,0.5)] scale-105 active:scale-95"
        >
          Save Agent Config
        </Button>
      </div>

      {/* Backbone Warning Modal */}
      {showBackboneWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <Card variant="solid" padding="lg" className="border-2 border-red-500/50 max-w-lg w-full shadow-[0_0_50px_rgba(239,68,68,0.2)] space-y-6">
            <div className="flex items-center gap-4 text-red-500">
              <Shield size={32} className="animate-pulse" />
              <Typography variant="h3" color="danger" weight="black" uppercase className="italic">Critical Backbone Modification</Typography>
            </div>
            
            <div className="space-y-4 font-mono text-[11px] leading-relaxed">
              <p className="text-white/80">
                <span className="text-red-500 font-bold">WARNING:</span> You are attempting to modify core backbone orchestrators:
              </p>
              <div className="bg-red-500/5 border border-red-500/20 p-3 rounded">
                {backboneChanges.map(name => (
                  <div key={name} className="text-red-400 font-bold">
                    {`> DETECTED_CHANGE: ${name}`}
                  </div>
                ))}
              </div>
              <p className="text-white/60">
                Backbone agents are critical to the system's connectivity and core logic. 
                Unauthorized or incorrect modifications can lead to cascading failures, deadlocked tasks, 
                or loss of system autonomy.
              </p>
              <p className="text-white font-bold italic border-l-2 border-red-500 pl-3">
                "I understand that these changes affect the system's fundamental architecture and I take full responsibility for this modification."
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Button
                onClick={() => handleSave(true)}
                variant="danger"
                size="lg"
                uppercase
                fullWidth
                className="shadow-[0_0_20px_rgba(220,38,38,0.3)] hover:scale-[1.02]"
              >
                I Understand Proceed with Save
              </Button>
              <Button
                onClick={() => setShowBackboneWarning(false)}
                variant="outline"
                size="md"
                uppercase
                fullWidth
                className="text-white/60"
              >
                Abort Modification
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* New Agent Modal */}
      {showNewAgentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <Card variant="solid" padding="lg" className="max-w-2xl w-full shadow-[0_0_50px_rgba(0,0,0,0.5)] space-y-6 relative">
            <Button 
              variant="ghost"
              size="sm"
              onClick={() => setShowNewAgentModal(false)}
              className="absolute top-4 right-4 text-white/40 hover:text-white p-0 h-auto"
              icon={<X size={20} />}
            />

            <div className="flex items-center gap-4 text-cyber-green">
              <Plus size={32} />
              <Typography variant="h2" color="primary" weight="black" uppercase className="italic">Config New Agent</Typography>
            </div>
            
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Typography variant="mono" weight="bold" color="white" uppercase className="text-[10px] opacity-50">Agent Name</Typography>
                  <input
                    value={newAgent.name}
                    onChange={(e) => setNewAgent(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-black/40 border border-white/10 rounded p-3 text-sm text-white outline-none focus:border-cyber-green/50 transition-all font-mono"
                    placeholder="e.g. Security Auditor"
                  />
                </div>
                <div className="space-y-2">
                  <Typography variant="mono" weight="bold" color="white" uppercase className="text-[10px] opacity-50">System ID (Immutable)</Typography>
                  <input
                    value={newAgent.id}
                    onChange={(e) => setNewAgent(prev => ({ ...prev, id: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                    className="w-full bg-black/40 border border-white/10 rounded p-3 text-sm text-white outline-none focus:border-cyber-green/50 transition-all font-mono"
                    placeholder="e.g. auditor_01"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Typography variant="mono" weight="bold" color="white" uppercase className="text-[10px] opacity-50">System Instructions (System Prompt)</Typography>
                <textarea
                  value={newAgent.systemPrompt}
                  onChange={(e) => setNewAgent(prev => ({ ...prev, systemPrompt: e.target.value }))}
                  className="w-full bg-black/40 border border-white/10 rounded p-4 text-xs text-white/90 font-mono min-h-[220px] outline-none focus:border-cyber-green/50 transition-all leading-relaxed custom-scrollbar"
                  placeholder="Define the agent's behavior, personality, and constraints..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Typography variant="mono" weight="bold" color="white" uppercase className="text-[10px] opacity-50">Initial Provider</Typography>
                  <CyberSelect
                    value={newAgent.provider || ''}
                    onChange={(val) => setNewAgent(prev => ({ ...prev, provider: val, model: '' }))}
                    options={[
                      { value: '', label: 'SYSTEM_DEFAULT' },
                      ...Object.entries(PROVIDERS).map(([id, p]) => ({
                        value: id,
                        label: p.label,
                      })),
                    ]}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Typography variant="mono" weight="bold" color="white" uppercase className="text-[10px] opacity-50">Initial Model</Typography>
                  <CyberSelect
                    value={newAgent.model || ''}
                    onChange={(val) => setNewAgent(prev => ({ ...prev, model: val }))}
                    options={
                      newAgent.provider
                        ? PROVIDERS[newAgent.provider as keyof typeof PROVIDERS]?.models.map((m) => ({
                            value: m,
                            label: m,
                          }))
                        : []
                    }
                    disabled={!newAgent.provider}
                    placeholder="SELECT_MODEL"
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <Button
                onClick={finalizeNewAgent}
                variant="primary"
                size="lg"
                uppercase
                fullWidth
                className="shadow-[0_0_20px_rgba(0,255,163,0.2)] hover:scale-[1.02]"
              >
                Authorize Agent Initialization
              </Button>
              <Button
                onClick={() => setShowNewAgentModal(false)}
                variant="outline"
                size="lg"
                uppercase
                className="px-8 text-white/60"
              >
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}
    </main>
  );
}
