'use client';

import React, { useState } from 'react';
import { Cpu, Settings } from 'lucide-react';
import Typography from '../ui/Typography';
import Badge from '../ui/Badge';
import type { Tool } from '@/lib/types/ui';

import { AgentConfig } from './types';

interface LibraryTabProps {
  allTools: Tool[];
  optimisticAgents: AgentConfig[];
  searchQuery: string;
  handleToggleToolAssignment: (
    agentId: string,
    toolName: string,
    isAttached: boolean
  ) => Promise<void>;
  isPending: boolean;
}

export default function LibraryTab({
  allTools,
  optimisticAgents,
  searchQuery,
  handleToggleToolAssignment,
  isPending,
}: LibraryTabProps) {
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);

  const universalSkills = ['discoverSkills', 'installSkill'];

  const filteredTools = allTools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group tools by their prefix or source
  const groups: Record<string, typeof filteredTools> = {};
  filteredTools.forEach((tool) => {
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

  return (
    <section className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {Object.entries(groups).map(([groupName, groupTools]) => (
        <div key={groupName} className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-white/5"></div>
            <h3 className="text-[10px] font-black tracking-[0.5em] text-cyber-blue flex items-center gap-2">
              <Cpu size={14} className="opacity-50" /> {groupName} Subsystem
            </h3>
            <div className="h-px flex-1 bg-white/5"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {groupTools.map((tool) => (
              <button
                key={tool.name}
                onClick={() => setSelectedTool(tool)}
                className={`group p-4 glass-card border-white/5 hover:border-cyber-blue/20 transition-all flex flex-col justify-between min-h-[100px] text-left ${tool.isExternal ? 'border-purple-500/10' : ''}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <Typography
                    variant="mono"
                    weight="black"
                    className={`text-[10px] tracking-wider ${tool.isExternal ? 'text-purple-400' : 'text-cyber-blue'}`}
                  >
                    {tool.name.includes('_') ? tool.name.split('_').slice(1).join('_') : tool.name}
                  </Typography>
                  {tool.usage && tool.usage.count > 0 && (
                    <div className="px-1.5 py-0.5 bg-white/5 rounded text-[8px] font-bold text-white/40">
                      {tool.usage.count}
                    </div>
                  )}
                </div>
                <Typography
                  variant="caption"
                  className="text-[9px] text-white/40 tracking-tighter leading-tight line-clamp-2"
                >
                  {tool.description}
                </Typography>

                <div className="mt-3 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[7px] text-white/20 font-mono tracking-widest">
                    Configure access
                  </span>
                  <Settings size={10} className="text-white/20" />
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Selection Modal */}
      {selectedTool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="w-full max-w-2xl glass-card border-white/10 overflow-hidden animate-in zoom-in-95 duration-300 shadow-2xl">
            <div className="p-8 border-b border-white/5 flex justify-between items-start bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-cyber-blue/10 via-transparent to-transparent">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Typography
                    variant="h3"
                    weight="black"
                    color="white"
                    glow
                    className="tracking-[0.2em]"
                  >
                    {selectedTool.name}
                  </Typography>
                  {selectedTool.isExternal && (
                    <Badge
                      variant="primary"
                      className="bg-purple-500/10 text-purple-400 font-bold border-purple-500/20 py-0.5"
                    >
                      Neural bridge
                    </Badge>
                  )}
                </div>
                <Typography
                  variant="body"
                  color="muted"
                  className="text-[10px] tracking-widest leading-relaxed max-w-lg block"
                >
                  {selectedTool.description}
                </Typography>
              </div>
              <button
                onClick={() => setSelectedTool(null)}
                className="p-2 bg-white/5 hover:bg-white/10 rounded-sm text-white/40 hover:text-white transition-colors border border-white/5"
              >
                ✕
              </button>
            </div>

            <div className="p-8 space-y-8">
              <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/20 flex items-center gap-2">
                  <Cpu size={14} /> Agent_Connectivity_Registry
                </h4>

                <div className="space-y-3">
                  {optimisticAgents
                    .filter((a) => a.id !== 'monitor' && a.id !== 'events' && a.id !== 'recovery')
                    .map((agent) => {
                      const isAttached = agent.tools.includes(selectedTool.name);
                      const isUniversal = universalSkills.includes(selectedTool.name);

                      return (
                        <div
                          key={agent.id}
                          className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-sm group hover:border-white/10 transition-all"
                        >
                          <div className="flex items-center gap-4">
                            <div
                              className={`w-10 h-10 rounded bg-white/5 flex items-center justify-center border border-white/5 transition-colors ${isAttached ? 'border-cyber-blue/30 text-cyber-blue bg-cyber-blue/5' : 'text-white/20'}`}
                            >
                              <Cpu size={18} />
                            </div>
                            <div>
                              <Typography
                                variant="body"
                                weight="black"
                                color="white"
                                className="uppercase tracking-widest"
                              >
                                {agent.name}
                              </Typography>
                              <Typography
                                variant="caption"
                                className="text-[8px] text-white/20 uppercase tracking-widest block font-mono"
                              >
                                ID: {agent.id}
                              </Typography>
                            </div>
                          </div>

                          <button
                            disabled={isPending || isUniversal}
                            onClick={() =>
                              handleToggleToolAssignment(agent.id, selectedTool.name, isAttached)
                            }
                            className={`px-4 py-2 text-[9px] font-black tracking-widest transition-all rounded ${
                              isAttached
                                ? 'bg-cyber-blue/80 hover:bg-red-500/80 text-white'
                                : 'border border-white/10 text-white/40 hover:text-white hover:border-cyber-blue/40'
                            }`}
                          >
                            {isAttached ? 'Attached' : 'Unassigned'}
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="p-4 bg-white/[0.02] border-t border-white/5 text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[8px] tracking-[0.3em] opacity-30"
              >
                [Secure access granted] - Tool assignments are live-synced to the neural core.
              </Typography>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
