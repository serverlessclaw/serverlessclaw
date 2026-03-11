'use client';

import React, { useState, useEffect } from 'react';
import { Bot, Save, Plus, Trash2, Shield, Settings2, RefreshCw, Cpu, ChevronRight } from 'lucide-react';
import CyberSelect from '@/components/CyberSelect';
import { THEME } from '@/lib/theme';

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

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agents),
      });
      if (!response.ok) throw new Error('Failed to save');
      setInitialAgents(JSON.parse(JSON.stringify(agents)));
      alert('Neural nodes synchronized successfully');
    } catch (err) {
      alert('Failed to save neural states');
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
    const id = `agent_${Date.now()}`;
    setAgents((prev) => ({
      ...prev,
      [id]: {
        id,
        name: 'New Specialized Node',
        systemPrompt: 'You are a specialized agent...',
        enabled: true,
        isBackbone: false,
      },
    }));
  };

  const deleteAgent = (id: string) => {
    if (agents[id].isBackbone) return;
    const next = { ...agents };
    delete next[id];
    setAgents(next);
  };

  const hasChanges = JSON.stringify(agents) !== JSON.stringify(initialAgents);

  if (loading)
    return (
      <main className="flex-1 p-10 flex items-center justify-center">
        <div className={`text-${THEME.COLORS.INTEL} animate-pulse font-mono tracking-widest uppercase text-sm flex items-center gap-3`}>
          <RefreshCw className="animate-spin" size={20} /> Initializing Neural Hub...
        </div>
      </main>
    );

  return (
    <main className={`flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-${THEME.COLORS.INTEL}/5 via-transparent to-transparent`}>
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <h2 className="text-2xl lg:text-3xl font-bold tracking-tight glow-text uppercase">
            AGENTS
          </h2>
          <p className="text-white/100 text-xs lg:text-sm mt-2 font-light">
            Manage backbone orchestrators and specialized autonomous agents.
          </p>
        </div>
        <button
          onClick={addAgent}
          className={`bg-white/5 hover:bg-white/10 text-white/100 px-4 py-2 rounded text-xs font-bold border border-white/10 flex items-center gap-2 transition-all hover:border-${THEME.COLORS.INTEL}/50 uppercase tracking-widest shadow-[0_0_15px_rgba(255,255,255,0.02)]`}
        >
          <Plus size={14} /> NEW_AGENT
        </button>
      </header>

      <div className="max-w-6xl space-y-8 pb-20">
        <div className="grid grid-cols-1 gap-6">
          {Object.values(agents).map((agent) => (
            <div
              key={agent.id}
              className={`glass-card p-6 border-l-2 transition-all ${
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
                    {agent.isBackbone ? <Shield size={20} /> : <Bot size={20} />}
                  </div>
                  <div>
                    <input
                      value={agent.name}
                      onChange={(e) => updateAgent(agent.id, { name: e.target.value })}
                      className="bg-transparent border-none text-white font-bold outline-none focus:ring-1 focus:ring-white/20 rounded px-1 text-base uppercase tracking-tight"
                      placeholder="Agent Name"
                    />
                    <div className="text-[10px] text-white/50 mt-1 font-mono flex items-center gap-2">
                      {agent.id} {agent.isBackbone && <span className={`text-${THEME.COLORS.INTEL} font-bold tracking-widest`}>[BACKBONE_PROTECTED]</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 self-end lg:self-center">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <span className={`text-[10px] font-bold text-white/100 tracking-widest group-hover:text-${THEME.COLORS.PRIMARY} transition-colors`}>ACTIVE_STATUS</span>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={agent.enabled}
                        onChange={(e) => updateAgent(agent.id, { enabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className={`w-10 h-5 bg-white/10 rounded-full peer peer-checked:bg-${THEME.COLORS.PRIMARY}/40 relative transition-all border border-white/5 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white/20 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5 peer-checked:after:bg-${THEME.COLORS.PRIMARY} shadow-inner`}></div>
                    </div>
                  </label>
                  {!agent.isBackbone && (
                    <button
                      onClick={() => deleteAgent(agent.id)}
                      className={`p-2 hover:bg-${THEME.COLORS.DANGER}/20 text-white/50 hover:text-${THEME.COLORS.DANGER} rounded transition-colors border border-transparent hover:border-${THEME.COLORS.DANGER}/30`}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Prompt Section */}
                <div className="lg:col-span-7 space-y-3">
                  <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex items-center gap-2">
                    <Settings2 size={12} className={`text-${THEME.COLORS.INTEL}`} /> Neural Core Instructions (System Prompt)
                  </label>
                  <div className="relative">
                    <textarea
                      value={agent.systemPrompt}
                      onChange={(e) => updateAgent(agent.id, { systemPrompt: e.target.value })}
                      className={`w-full bg-black/40 border border-white/10 rounded p-4 text-xs text-white/90 font-mono min-h-[180px] outline-none focus:border-${THEME.COLORS.INTEL}/40 transition-all leading-relaxed custom-scrollbar`}
                      placeholder="Enter the system instructions for this node..."
                    />
                  </div>
                </div>

                {/* Model & Config Section */}
                <div className="lg:col-span-5 space-y-6">
                  <div className="space-y-4 bg-white/[0.02] p-4 rounded border border-white/5">
                    <h4 className="text-[10px] font-bold text-white/100 uppercase tracking-widest flex items-center gap-2">
                        <Cpu size={12} className={`text-${THEME.COLORS.PRIMARY}`} /> Hardware_Alignment
                    </h4>
                    
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[9px] uppercase text-white/100 tracking-widest font-bold opacity-60">LLM Provider</label>
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
                        <label className="text-[9px] uppercase text-white/100 tracking-widest font-bold opacity-60">Neural Model ID</label>
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
                  </div>

                  <div className={`p-4 border border-${THEME.COLORS.INTEL}/10 bg-${THEME.COLORS.INTEL}/[0.02] rounded`}>
                    <div className={`text-[10px] font-bold text-${THEME.COLORS.INTEL} uppercase tracking-widest flex items-center gap-2 mb-2`}>
                        <ChevronRight size={12} /> Execution_Context
                    </div>
                    <p className="text-[10px] text-white/100 font-light leading-relaxed italic">
                        Node type: {agent.isBackbone ? 'PERSISTENT_BACKBONE' : 'DYNAMIC_SPOKE'}.
                        Authorized to interact with global bus and session memory.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Floating Save Button */}
      <div className="fixed bottom-10 right-10 z-30">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className={`${THEME.CLASSES.BUTTON_PRIMARY} px-8 py-4 rounded text-xs font-black flex items-center gap-3 hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:grayscale disabled:scale-100 uppercase tracking-widest border border-white/20`}
        >
          {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
          SAVE_AGENT_CONFIG
        </button>
      </div>
    </main>
  );
}
