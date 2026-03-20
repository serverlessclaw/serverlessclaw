'use client';

import React, { useState, useEffect } from 'react';
import { 
  Search, Loader2, 
  Activity, BookOpen, ExternalLink, Zap, Cpu 
} from 'lucide-react';
import Button from '../ui/Button';
import Typography from '../ui/Typography';
import Card from '../ui/Card';
import type { Tool } from '@/lib/types/ui';
import AnalyticsTab from './AnalyticsTab';
import AgentsTab from './AgentsTab';
import MCPTab from './MCPTab';
import LibraryTab from './LibraryTab';
import { useAgentTools } from './useAgentTools';

import { AgentConfig, CapabilitiesViewProps } from './types';

export default function CapabilitiesView({ allTools, mcpServers, agents }: CapabilitiesViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'agents' | 'library' | 'analytics' | 'mcp'>('analytics');
  
  const {
    optimisticAgents,
    setOptimisticAgents,
    isPending,
    handleToggleToolAssignment
  } = useAgentTools(agents);

  // Sync with props if they change
  useEffect(() => {
    setOptimisticAgents(agents);
  }, [agents, setOptimisticAgents]);

  return (
    <div className={`space-y-10 transition-all duration-500 ${isPending ? 'opacity-80' : 'opacity-100'}`}>
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
        </div>
      </div>

      {activeTab === 'analytics' && (
        <AnalyticsTab 
          allTools={allTools}
          agents={agents}
          optimisticAgents={optimisticAgents}
          setOptimisticAgents={setOptimisticAgents}
          handleDetachTool={handleDetachTool}
          confirmModal={confirmModal}
          setConfirmModal={setConfirmModal}
          isPending={isPending}
        />
      )}

      {activeTab === 'agents' && (
        <AgentsTab 
          allTools={allTools}
          agents={agents}
          optimisticAgents={optimisticAgents}
          setOptimisticAgents={setOptimisticAgents}
          searchQuery={searchQuery}
        />
      )}

      {activeTab === 'mcp' && (
        <MCPTab mcpServers={mcpServers} searchQuery={searchQuery} />
      )}

      {activeTab === 'library' && (
        <LibraryTab 
          allTools={allTools}
          optimisticAgents={optimisticAgents}
          searchQuery={searchQuery}
          handleToggleToolAssignment={handleToggleToolAssignment}
          isPending={isPending}
        />
      )}
    </div>
  );
}