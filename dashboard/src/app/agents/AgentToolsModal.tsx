"use client";

import React from 'react';
import { Search, Plus, Wrench, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Typography from '@/components/ui/Typography';
import { Tool } from '@/lib/types/ui';

interface Props {
  selectedAgentIdForTools: string | null;
  agents: Record<string, any>;
  allTools: Tool[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  setSelectedAgentIdForTools: (id: string | null) => void;
  handleToggleTool: (agentId: string, toolName: string) => void;
  isUpdatingTools: boolean;
}

export default function AgentToolsModal({
  selectedAgentIdForTools,
  agents,
  allTools,
  searchQuery,
  setSearchQuery,
  setSelectedAgentIdForTools,
  handleToggleTool,
  isUpdatingTools,
}: Props) {
  if (!selectedAgentIdForTools || !agents[selectedAgentIdForTools]) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <Card variant="solid" padding="lg" className="max-w-4xl w-full max-h-[90vh] flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden border-cyber-green/20">
        <Button 
          variant="ghost"
          size="sm"
          onClick={() => setSelectedAgentIdForTools(null)}
          className="absolute top-4 right-4 text-white/40 hover:text-white p-0 h-auto z-10"
          icon={<X size={20} />}
        />

        <header className="mb-6">
          <div className="flex items-center gap-4 text-cyber-green mb-2">
            <Wrench size={24} />
            <Typography variant="h2" color="primary" weight="black" uppercase className="italic">Manage Agent Tools</Typography>
          </div>
          <Typography variant="body" color="white" className="opacity-80 block">
            Assign functional capabilities to <span className="text-white font-black underline decoration-cyber-green/30 underline-offset-4">{agents[selectedAgentIdForTools].name}</span>
          </Typography>
        </header>

        <div className="mb-6 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-white/20">
            <Search size={14} />
          </div>
          <input 
            type="text"
            placeholder="Search tools & skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-sm py-2 pl-10 pr-4 text-xs text-white outline-none focus:border-cyber-green/50 transition-all font-mono"
          />
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-8">
          {/* Active Tools */}
          <div>
            <Typography variant="caption" weight="black" color="muted" className="tracking-[0.2em] mb-4 flex items-center gap-2">
              <Plus size={12} className="text-white/40" /> 
              Active Skills
            </Typography>
            <div className="flex flex-wrap gap-2">
              {(agents[selectedAgentIdForTools].tools || []).map((toolName: string) => {
                const isUniversal = ['discoverSkills', 'installSkill'].includes(toolName);
                return (
                  <div 
                    key={toolName} 
                    className={`group flex items-center gap-3 pl-3 pr-1 py-1 border transition-all ${
                      isUniversal ? 'bg-blue-500/5 border-blue-500/20 text-blue-400' : 'bg-cyber-green/5 border-cyber-green/20 text-cyber-green'
                    }`}
                  >
                    <Typography variant="mono" className="text-[10px] uppercase font-bold tracking-widest">
                      {toolName}
                      {isUniversal && <span className="ml-2 text-[8px] opacity-40 font-mono">(Core)</span>}
                    </Typography>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleTool(selectedAgentIdForTools, toolName)}
                      disabled={isUpdatingTools || isUniversal}
                      className="p-1 hover:bg-red-500/20 text-red-500/60 hover:text-red-500 transition-all h-6 w-6"
                      icon={<Plus size={10} />}
                    />
                  </div>
                );
              })}
              {(agents[selectedAgentIdForTools].tools || []).length === 0 && (
                <Typography variant="mono" color="muted" className="text-[10px] italic">No active tools assigned.</Typography>
              )}
            </div>
          </div>

          {/* Available Tools */}
          <div>
            <Typography variant="caption" weight="black" color="muted" className="tracking-[0.2em] mb-4 flex items-center gap-2">
              <Plus size={12} className="text-white/40" /> 
              Available Insertions
            </Typography>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {allTools
                .filter(t => !(agents[selectedAgentIdForTools]?.tools || []).includes(t.name))
                .filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.description.toLowerCase().includes(searchQuery.toLowerCase()))
                .map(tool => (
                  <Button
                    key={tool.name}
                    variant="ghost"
                    onClick={() => handleToggleTool(selectedAgentIdForTools, tool.name)}
                    disabled={isUpdatingTools}
                    className={`flex flex-col items-start p-3 rounded-sm border border-white/5 bg-white/[0.02] hover:bg-cyber-green/10 hover:border-cyber-green/30 transition-all h-auto text-left group`}
                  >
                    <div className="flex justify-between items-center w-full mb-1">
                      <Typography variant="mono" className="text-[10px] font-bold text-white/90 group-hover:text-cyber-green transition-colors uppercase">
                        {tool.name}
                      </Typography>
                      <Plus size={10} className="text-white/40 group-hover:text-cyber-green" />
                    </div>
                    <Typography variant="mono" className="text-[9px] line-clamp-2 leading-relaxed h-8 text-white/50 group-hover:text-white/70 transition-colors">
                      {tool.description}
                    </Typography>
                  </Button>
                ))
              }
            </div>
          </div>
        </div>

        <footer className="mt-8 pt-6 border-t border-white/5 flex justify-between items-center bg-black/20 shrink-0">
          <Typography variant="mono" color="muted" className="text-[10px] italic">
            {isUpdatingTools ? 'Synchronizing neural pathways...' : 'System stable. All changes persisted immediately.'}
          </Typography>
          <Button 
            variant="primary"
            size="sm"
            onClick={() => setSelectedAgentIdForTools(null)}
            className="px-8 shadow-[0_0_15px_rgba(0,255,163,0.2)]"
          >
            Close
          </Button>
        </footer>
      </Card>
    </div>
  );
}
