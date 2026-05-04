'use client';

import React, { useState, useEffect } from 'react';
import AgentsTab from './AgentsTab';
import AnalyticsTab from './AnalyticsTab';
import Button from '../ui/Button';
import { Search, Activity, BookOpen, ExternalLink, Cpu, Sparkles } from 'lucide-react';
import MCPTab from './MCPTab';
import LibraryTab from './LibraryTab';
import LeaderboardTab from './LeaderboardTab';
import { useAgentTools } from './useAgentTools';
import { useMCPTools } from './useMCPTools';

import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { CapabilitiesViewProps } from './types';

export default function CapabilitiesView({ allTools, mcpServers, agents }: CapabilitiesViewProps) {
  const { t } = useTranslations();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'agents' | 'library' | 'analytics' | 'mcp' | 'usage'>(
    'analytics'
  );

  const {
    optimisticAgents,
    setOptimisticAgents,
    isPending,
    handleToggleToolAssignment,
    handleDetachTool,
    confirmModal,
    setConfirmModal,
  } = useAgentTools(agents);

  const mappedTools = React.useMemo(
    () => allTools.map((t) => ({ ...t, isExternal: !!t.isExternal })),
    [allTools]
  );

  const { mcpTools } = useMCPTools(mappedTools);

  // Sync with props if they change
  useEffect(() => {
    setOptimisticAgents(agents);
  }, [agents, setOptimisticAgents]);

  return (
    <div
      className={`space-y-10 transition-all duration-500 ${isPending ? 'opacity-80' : 'opacity-100'}`}
    >
      {/* Navigation & Search */}
      <div className="flex flex-col lg:flex-row gap-6 justify-between items-start lg:items-center sticky top-0 z-20 bg-background/90 backdrop-blur-xl p-6 border-b border-border -mx-6 lg:-mx-10 -mt-10 mb-10">
        <nav className="flex gap-1 bg-input p-1 rounded-sm border border-border overflow-x-auto no-scrollbar">
          {[
            { id: 'analytics', label: t('CAPABILITIES_TAB_DASHBOARD'), icon: Activity },
            { id: 'usage', label: t('CAPABILITIES_TAB_LEADERBOARD'), icon: Sparkles },
            { id: 'agents', label: t('CAPABILITIES_TAB_ASSIGNMENTS'), icon: Cpu },
            { id: 'library', label: t('CAPABILITIES_TAB_LIBRARY'), icon: BookOpen },
            { id: 'mcp', label: t('CAPABILITIES_TAB_SKILL_BRIDGES'), icon: ExternalLink },
          ].map((tab) => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? 'primary' : 'ghost'}
              size="sm"
              onClick={() =>
                setActiveTab(tab.id as 'agents' | 'library' | 'analytics' | 'mcp' | 'usage')
              }
              icon={<tab.icon size={12} />}
              className={`px-6 font-black tracking-widest transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'shadow-[0_0_20px_rgba(0,224,255,0.2)]'
                  : 'text-muted-foreground hover:text-foreground'
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
            placeholder={t('CAPABILITIES_SEARCH_PLACEHOLDER')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-input border border-border focus:border-cyber-blue/40 rounded-sm py-3 pl-12 pr-4 text-[10px] outline-none transition-all placeholder:text-muted-more font-mono tracking-widest"
          />
        </div>
      </div>

      {activeTab === 'analytics' && (
        <AnalyticsTab
          allTools={mcpTools}
          optimisticAgents={optimisticAgents}
          handleDetachTool={handleDetachTool}
          confirmModal={confirmModal}
          setConfirmModal={setConfirmModal}
          isPending={isPending}
        />
      )}

      {activeTab === 'usage' && <LeaderboardTab allTools={mcpTools} searchQuery={searchQuery} />}

      {activeTab === 'agents' && (
        <AgentsTab
          allTools={mcpTools}
          agents={agents}
          optimisticAgents={optimisticAgents}
          setOptimisticAgents={setOptimisticAgents}
          searchQuery={searchQuery}
        />
      )}

      {activeTab === 'mcp' && <MCPTab mcpServers={mcpServers} searchQuery={searchQuery} />}

      {activeTab === 'library' && (
        <LibraryTab
          allTools={mcpTools}
          optimisticAgents={optimisticAgents}
          searchQuery={searchQuery}
          handleToggleToolAssignment={handleToggleToolAssignment}
          isPending={isPending}
        />
      )}
    </div>
  );
}
