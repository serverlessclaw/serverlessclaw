'use client';

import React, { useState, useEffect } from 'react';
import { Bot, Save, Plus, Trash2, Shield, Settings2, RefreshCw } from 'lucide-react';

interface AgentConfig {
  id: string;
  name: string;
  systemPrompt: string;
  model?: string;
  enabled: boolean;
  isBackbone?: boolean;
}

export default function AgentsManager() {
  const [agents, setAgents] = useState<Record<string, AgentConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/agents')
      .then(res => res.json())
      .then(data => {
        setAgents(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load agents:', err);
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agents),
      });
      alert('Agents updated successfully');
    } catch (err) {
      alert('Failed to save agents');
    } finally {
      setSaving(false);
    }
  };

  const updateAgent = (id: string, updates: Partial<AgentConfig>) => {
    setAgents(prev => ({
      ...prev,
      [id]: { ...prev[id], ...updates }
    }));
  };

  const addAgent = () => {
    const id = `agent_${Date.now()}`;
    setAgents(prev => ({
      ...prev,
      [id]: {
        id,
        name: 'New Agent',
        systemPrompt: 'You are a helpful assistant...',
        enabled: true,
        isBackbone: false
      }
    }));
  };

  const deleteAgent = (id: string) => {
    if (agents[id].isBackbone) return;
    const next = { ...agents };
    delete next[id];
    setAgents(next);
  };

  if (loading) return <div className="text-white/20 animate-pulse">Initializing Neural Hub...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold flex items-center gap-2 text-cyber-green uppercase tracking-wider">
          <Bot size={16} /> NEURAL_AGENT_REGISTRY
        </h3>
        <button 
          onClick={addAgent}
          className="bg-white/5 hover:bg-white/10 text-white/80 px-3 py-1.5 rounded text-[10px] font-bold border border-white/10 flex items-center gap-2 transition-all"
        >
          <Plus size={14} /> REGISTER_NEW_NODE
        </button>
      </div>

      <div className="grid gap-4">
        {Object.values(agents).map(agent => (
          <div key={agent.id} className={`glass-card p-6 border-l-2 ${agent.isBackbone ? 'border-cyber-blue shadow-[0_0_15px_rgba(0,224,255,0.05)]' : 'border-white/10'}`}>
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded ${agent.isBackbone ? 'bg-cyber-blue/20 text-cyber-blue' : 'bg-white/5 text-white/40'}`}>
                  {agent.isBackbone ? <Shield size={18} /> : <Bot size={18} />}
                </div>
                <div>
                  <input 
                    value={agent.name}
                    onChange={e => updateAgent(agent.id, { name: e.target.value })}
                    className="bg-transparent border-none text-white font-bold outline-none focus:ring-1 focus:ring-white/20 rounded px-1 text-sm uppercase tracking-tight"
                    disabled={agent.isBackbone}
                  />
                  <div className="text-[10px] text-white/20 mt-1 font-mono">{agent.id} {agent.isBackbone && '[PROTECTED_BACKBONE]'}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-[9px] font-bold text-white/40 tracking-widest">ACTIVE</span>
                  <input 
                    type="checkbox"
                    checked={agent.enabled}
                    onChange={e => updateAgent(agent.id, { enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-white/10 rounded-full peer peer-checked:bg-cyber-green/40 relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white/20 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4 peer-checked:after:bg-cyber-green shadow-inner"></div>
                </label>
                {!agent.isBackbone && (
                  <button 
                    onClick={() => deleteAgent(agent.id)}
                    className="p-1.5 hover:bg-red-500/20 text-white/20 hover:text-red-500 rounded transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] uppercase text-white/30 tracking-widest font-bold flex items-center gap-2">
                  <Settings2 size={10} /> Neural Instructions (System Prompt)
                </label>
                <textarea 
                  value={agent.systemPrompt}
                  onChange={e => updateAgent(agent.id, { systemPrompt: e.target.value })}
                  className="w-full bg-black/40 border border-white/5 rounded p-3 text-xs text-white/60 font-mono min-h-[120px] outline-none focus:border-cyber-green/30 transition-colors leading-relaxed"
                  disabled={agent.isBackbone}
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1 space-y-2">
                  <label className="text-[10px] uppercase text-white/30 tracking-widest font-bold">Inference Model Overwrite</label>
                  <input 
                    value={agent.model || ''}
                    onChange={e => updateAgent(agent.id, { model: e.target.value })}
                    placeholder="Inherit from global config"
                    className="w-full bg-black/40 border border-white/5 rounded px-3 py-2 text-[11px] text-white/80 outline-none focus:border-cyber-green/30 transition-colors"
                    disabled={agent.isBackbone}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-4">
        <button 
          onClick={handleSave}
          disabled={saving}
          className="bg-cyber-green text-black px-6 py-2.5 rounded text-xs font-bold flex items-center gap-2 hover:scale-105 transition-transform cursor-pointer shadow-[0_0_20px_rgba(0,255,163,0.3)] disabled:opacity-50 uppercase tracking-widest"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          Synchronize_Neural_States
        </button>
      </div>
    </div>
  );
}
