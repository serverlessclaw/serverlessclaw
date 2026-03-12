'use client';

import React, { useState } from 'react';
import { Wrench, Shield, Zap, Cpu, Settings, Save, Search } from 'lucide-react';
import { updateAgentTools } from '../app/capabilities/actions';

interface Tool {
  name: string;
  description: string;
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
}

export default function CapabilitiesView({ agents, allTools }: CapabilitiesViewProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTools = allTools.filter(tool => 
    tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    tool.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-10">
      <div className="relative max-w-xl">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Search size={18} className="text-yellow-500/50" />
        </div>
        <input
          type="text"
          placeholder="SEARCH_CAPABILITIES..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-black/40 border border-yellow-500/10 focus:border-yellow-500/40 rounded-lg py-4 pl-12 pr-4 text-sm outline-none transition-all placeholder:text-yellow-500/30 font-mono"
        />
        <div className="absolute inset-y-0 right-4 flex items-center">
            <span className="text-[10px] font-bold text-yellow-500/40 bg-yellow-500/5 px-2 py-1 rounded border border-yellow-500/10 uppercase tracking-widest">
                {filteredTools.length} / {allTools.length} TOOLS
            </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {agents.map(agent => (
          <form key={agent.id} action={updateAgentTools} className="glass-card p-6 space-y-6 cyber-border border-yellow-500/10 hover:border-yellow-500/20 transition-all">
            <input type="hidden" name="agentId" value={agent.id} />
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-sm bg-yellow-500/10 flex items-center justify-center text-yellow-500 border border-yellow-500/20 shadow-[0_0_15px_rgba(234,179,8,0.05)]">
                   {agent.id === 'main' ? <Zap size={20} /> : agent.id === 'coder' ? <Cpu size={20} /> : <Settings size={20} />}
                </div>
                <div>
                  <h3 className="text-sm font-black text-yellow-500 uppercase tracking-[0.2em]">
                    {agent.name}
                  </h3>
                  <p className="text-[9px] text-white/40 uppercase tracking-widest truncate max-w-[200px]">
                    {agent.description || 'Specialized Neural Node'}
                  </p>
                </div>
              </div>
              <button 
                type="submit"
                className="text-[10px] font-black px-4 py-2 rounded-sm bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500 hover:text-black transition-all flex items-center gap-2 border border-yellow-500/30 shadow-[0_0_20px_rgba(234,179,8,0.1)] uppercase tracking-widest"
              >
                <Save size={12} /> SYNC_ROSTER
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar border-t border-white/5 pt-4">
              {filteredTools.map(tool => {
                const isEnabled = agent.tools.includes(tool.name);
                return (
                  <label 
                    key={tool.name} 
                    className={`flex items-start gap-4 p-4 rounded-sm border transition-all cursor-pointer group ${
                      isEnabled 
                        ? 'bg-yellow-500/5 border-yellow-500/30 text-white shadow-[inset_0_0_15px_rgba(234,179,8,0.02)]' 
                        : 'bg-white/[0.01] border-white/5 text-white/30 hover:border-white/20 hover:bg-white/[0.03]'
                    }`}
                  >
                    <input 
                      type="checkbox" 
                      name="tools" 
                      value={tool.name} 
                      defaultChecked={isEnabled}
                      className="mt-1 accent-yellow-500 w-4 h-4 rounded-none border-white/20"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-[11px] font-black uppercase tracking-[0.1em] ${isEnabled ? 'text-yellow-500' : 'text-white/60'}`}>
                          {tool.name}
                        </span>
                        {tool.name === 'fileWrite' && <Shield size={10} className="text-red-500/60" />}
                      </div>
                      <p className={`text-[10px] leading-relaxed font-light ${isEnabled ? 'text-white/70' : 'text-white/20'}`}>
                        {tool.description}
                      </p>
                    </div>
                  </label>
                );
              })}
              {filteredTools.length === 0 && (
                <div className="py-10 text-center space-y-3 opacity-20">
                    <Search size={32} className="mx-auto" />
                    <p className="text-[10px] uppercase tracking-widest">No tools match your query</p>
                </div>
              )}
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
