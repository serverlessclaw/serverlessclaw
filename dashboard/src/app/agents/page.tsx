'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Shield, RefreshCw, Radio, Search } from 'lucide-react';
import { toast } from 'sonner';
import CyberConfirm from '@/components/CyberConfirm';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import NewAgentModal from './NewAgentModal';
import AgentToolsModal from './AgentToolsModal';
import AgentTable from './AgentTable';
import { Tool, Agent } from '@/lib/types/ui';
import PageHeader from '@/components/PageHeader';
import { useRealtime, RealtimeMessage } from '@/hooks/useRealtime';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { logger } from '@claw/core/lib/logger';

import {
  LLMProvider,
  OpenAIModel,
  BedrockModel,
  MiniMaxModel,
  OpenRouterModel,
} from '@claw/core/lib/types/llm';

// Agent interface moved to ui.ts

const PROVIDERS = {
  [LLMProvider.OPENAI]: {
    label: 'OpenAI (Native)',
    models: [
      OpenAIModel.GPT_5_4,
      OpenAIModel.GPT_5_4_MINI,
      OpenAIModel.GPT_5_4_NANO,
      OpenAIModel.GPT_5_MINI,
    ],
  },
  [LLMProvider.BEDROCK]: {
    label: 'AWS Bedrock (Native)',
    models: [BedrockModel.CLAUDE_4_6],
  },
  [LLMProvider.MINIMAX]: {
    label: 'MiniMax (Native)',
    models: [MiniMaxModel.M2_7, MiniMaxModel.M2_7_HIGHSPEED],
  },
  [LLMProvider.OPENROUTER]: {
    label: 'OpenRouter (Aggregator)',
    models: [OpenRouterModel.GLM_5, OpenRouterModel.GEMINI_3_FLASH],
  },
};

/** AgentsPage — manages the Neural Agent Registry: configure agent personas, toggle tool scopes, and register new dynamic agents without redeploying. */
export default function AgentsPage() {
  const { t } = useTranslations();
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [initialAgents, setInitialAgents] = useState<Record<string, Agent>>({});
  const [loading, setLoading] = useState(true);
  const [loadingTools, setLoadingTools] = useState(false);
  const [refreshingTools, setRefreshingTools] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showBackboneWarning, setShowBackboneWarning] = useState(false);
  const [backboneChanges, setBackboneChanges] = useState<string[]>([]);
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  const [newAgent, setNewAgent] = useState<Partial<Agent>>({
    name: '',
    id: '',
    systemPrompt: '',
    enabled: true,
    isBackbone: false,
  });

  const [allTools, setAllTools] = useState<Tool[]>([]);
  const [selectedAgentIdForTools, setSelectedAgentIdForTools] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [isUpdatingTools, setIsUpdatingTools] = useState(false);
  const [reputation, setReputation] = useState<
    Record<
      string,
      { successRate: number; avgLatencyMs: number; tasksCompleted: number; tasksFailed: number }
    >
  >({});

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    agentId: string;
    agentName: string;
  }>({
    isOpen: false,
    agentId: '',
    agentName: '',
  });

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agents');
      const data: Agent[] = await res.json();
      const agentsMap = data.reduce((acc: Record<string, Agent>, agent: Agent) => {
        acc[agent.id] = agent;
        return acc;
      }, {} as Record<string, Agent>);
      setAgents(agentsMap);
      setInitialAgents(structuredClone(agentsMap));
    } catch (err) {
      logger.error('Failed to load agents:', err);
      toast.error(t('AGENTS_SYNC_REGISTRY_ERROR'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadTools = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshingTools(true);
    else setLoadingTools(true);

    try {
      const toolsRes = await fetch(`/api/tools${forceRefresh ? '?refresh=true' : ''}`);
      const toolsData = await toolsRes.json();
      setAllTools(toolsData.tools || []);
      if (forceRefresh) toast.success(t('AGENTS_TOOL_CACHE_SYNCED'));
    } catch (err) {
      logger.error('Failed to load tools:', err);
      toast.error(t('AGENTS_TOOL_REGISTRY_ERROR'));
    } finally {
      setLoadingTools(false);
      setRefreshingTools(false);
    }
  }, [t]);

  const syncRegistry = async () => {
    setRefreshingTools(true);
    try {
      await Promise.all([loadAgents(), loadTools(true)]);
      toast.success(t('AGENTS_REGISTRY_SYNCED'));
    } catch (err) {
      logger.error('Sync failed:', err);
      toast.error(t('AGENTS_SYNC_ERROR'));
    } finally {
      setRefreshingTools(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    if (selectedAgentIdForTools && allTools.length === 0 && !loadingTools) {
      loadTools();
    }
  }, [selectedAgentIdForTools, allTools.length, loadingTools, loadTools]);

  const loadReputation = useCallback(async () => {
    try {
      const res = await fetch('/api/reputation');
      const data = await res.json();
      setReputation(data);
    } catch (err) {
      logger.error('Failed to load reputation:', err);
    }
  }, []);

  useEffect(() => {
    loadReputation();
  }, [loadReputation]);

  const handleSave = async (force: boolean = false) => {
    // Detect backbone changes
    if (!force) {
      const changedBackbone = Object.values(agents)
        .filter((agent) => {
          if (!agent.isBackbone) return false;
          const initial = initialAgents[agent.id];
          if (!initial) return false;
          return (
            agent.name !== initial.name ||
            agent.systemPrompt !== initial.systemPrompt ||
            agent.model !== initial.model ||
            agent.provider !== initial.provider ||
            agent.reasoningProfile !== initial.reasoningProfile ||
            agent.enabled !== initial.enabled
          );
        })
        .map((a) => a.name ?? a.id);

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
      setInitialAgents(structuredClone(agents));
      toast.success(t('AGENTS_CONFIG_SYNCED'));
      setShowBackboneWarning(false);
    } catch (err) {
      logger.error('Failed to save agent configuration:', err);
      toast.error(t('AGENTS_SAVE_ERROR'));
    } finally {
      setSaving(false);
    }
  };

  const updateAgent = (id: string, updates: Partial<Agent>) => {
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
      agentType: 'llm',
      tools: [],
    });
  };

  const finalizeNewAgent = () => {
    if (!newAgent.id || !newAgent.name) {
      toast.error(t('AGENTS_ID_NAME_REQUIRED'));
      return;
    }

    setAgents((prev) => ({
      ...prev,
      [newAgent.id!]: { ...newAgent, tools: [] } as Agent,
    }));
    setShowNewAgentModal(false);
  };

  const handleToggleTool = async (agentId: string, toolName: string) => {
    const agent = agents[agentId];
    if (!agent) return;

    const isEnabled = agent.tools.includes(toolName);
    const newTools = isEnabled
      ? agent.tools.filter((t) => t !== toolName)
      : [...agent.tools, toolName];

    // Store snapshot before optimistic update for rollback
    const previousTools = [...agent.tools];

    // Optimistic Update
    setAgents((prev: Record<string, Agent>) => ({
      ...prev,
      [agentId]: { ...prev[agentId], tools: newTools },
    }));

    setIsUpdatingTools(true);
    try {
      const { updateAgentTools } = await import('@/app/capabilities/actions');
      const formData = new FormData();
      formData.append('agentId', agentId);
      newTools.forEach((t) => formData.append('tools', t));

      const result = await updateAgentTools(formData);
      if (result?.error) throw new Error(result.error);

      toast.success(t('AGENTS_TOOLS_UPDATED'));
    } catch (err) {
      logger.error('Failed to update tools:', err);
      toast.error('Failed to update tools');
      // Revert to snapshot taken before toggle
      setAgents((prev) => ({
        ...prev,
        [agentId]: { ...prev[agentId], tools: previousTools },
      }));
    } finally {
      setIsUpdatingTools(false);
    }
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
    toast.success(t('AGENTS_DECOMMISSIONED_SUCCESS').replace('{name}', confirmModal.agentName));
  };

  const cloneAgent = (id: string) => {
    const original = agents[id];
    if (!original) return;

    const newId = `${id}-clone-${Date.now().toString().slice(-4)}`;
    const clonedAgent: Agent = {
      ...structuredClone(original),
      id: newId,
      name: `${original.name} (Clone)`,
      isBackbone: false,
      enabled: false,
    };

    setAgents((prev) => ({
      ...prev,
      [newId]: clonedAgent,
    }));
    toast.success(t('AGENTS_CLONED_SUCCESS').replace('{name}', original.name));
  };

  // Real-time message handler for agent state changes
  const handleRealtimeMessage = useCallback((_topic: string, message: RealtimeMessage) => {
    const type = message['detail-type'];

    // Refresh agents on relevant events
    if (
      type === 'agent_config_updated' ||
      type === 'agent_status_changed' ||
      type === 'task_completed' ||
      type === 'task_failed'
    ) {
      logger.info(`[Realtime] Refreshing agents due to: ${type}`);
      loadAgents();
      loadReputation();
    }
  }, [loadAgents, loadReputation]);

  // Use Realtime Hook for live updates
  const { isConnected } = useRealtime({
    topics: ['agents/+/signal', 'system/+/signal'],
    onMessage: handleRealtimeMessage,
  });

  const hasChanges = JSON.stringify(agents) !== JSON.stringify(initialAgents);

  const totalLlmAgents = Object.values(agents).filter(
    (agent) => agent.agentType !== 'logic'
  ).length;

  const filteredAgents = Object.fromEntries(
    Object.entries(agents).filter(([id, agent]) => {
      // Only list LLM based agents
      if (agent.agentType === 'logic') return false;

      const searchStr = agentSearchQuery.toLowerCase();
      return agent.name.toLowerCase().includes(searchStr) || id.toLowerCase().includes(searchStr);
    })
  );

  if (loading)
    return (
      <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
        <div className="flex items-center justify-center min-h-[400px] text-white/40">
          <Typography
            variant="mono"
            color="intel"
            uppercase
            className="flex items-center gap-3 animate-pulse"
          >
            <RefreshCw className="animate-spin" size={20} /> {t('AGENTS_INITIALIZING')}
          </Typography>
        </div>
      </main>
    );

  return (
    <main
      className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent"
    >
      <CyberConfirm
        isOpen={confirmModal.isOpen}
        title={t('AGENTS_DECOMMISSION_TITLE')}
        message={t('AGENTS_DECOMMISSION_MESSAGE').replace('{name}', confirmModal.agentName)}
        variant="danger"
        onConfirm={executeDeleteAgent}
        onCancel={() => setConfirmModal({ isOpen: false, agentId: '', agentName: '' })}
      />
      <PageHeader
        titleKey="AGENTS_TITLE"
        subtitleKey="AGENTS_SUBTITLE"
        stats={
          <div className="flex flex-col items-center">
            <Typography
              variant="mono"
              color="muted"
              className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
            >
              NODES
            </Typography>
            <Badge
              variant="outline"
              className="px-4 py-1 font-bold text-xs border-cyber-blue/20 text-cyber-blue/60 uppercase"
            >
              {totalLlmAgents}
            </Badge>
          </div>
        }
      >
        <div className="flex flex-wrap gap-4 items-end">
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-widest font-bold ${isConnected ? 'bg-cyber-green/10 text-cyber-green border border-cyber-green/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}
          >
            <Radio size={10} className={isConnected ? 'animate-pulse' : ''} />
            {isConnected ? t('AGENTS_SIGNAL_ACTIVE') : t('AGENTS_SIGNAL_DISCONNECTED')}
          </div>
          <div className="relative w-64 group">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-cyan-400 transition-colors">
              <Search size={14} />
            </div>
            <input
              type="text"
              placeholder="Search nodes..."
              value={agentSearchQuery}
              onChange={(e) => setAgentSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/5 rounded h-[34px] pl-9 pr-3 text-xs font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-cyan-400/30 focus:bg-white/[0.08] transition-all"
            />
          </div>
          <Button
            onClick={syncRegistry}
            variant="outline"
            size="sm"
            disabled={refreshingTools}
            icon={<RefreshCw size={14} className={refreshingTools ? 'animate-spin' : ''} />}
            className="h-[34px] uppercase font-black tracking-widest border-white/5 hover:bg-white/5"
          >
            {refreshingTools ? t('AGENTS_SYNCING') : t('AGENTS_SYNC_REGISTRY')}
          </Button>
          <Button
            onClick={addAgent}
            variant="outline"
            size="sm"
            icon={<Plus size={14} />}
            className="h-[34px] uppercase font-black tracking-widest"
          >
            {t('AGENTS_NEW_AGENT')}
          </Button>
        </div>
      </PageHeader>

      <div className="max-w-6xl space-y-8 pb-20">
        <AgentTable
          agents={filteredAgents}
          reputation={reputation}
          updateAgent={updateAgent}
          deleteAgent={deleteAgent}
          cloneAgent={cloneAgent}
          setSelectedAgentIdForTools={setSelectedAgentIdForTools}
          onSave={() => handleSave()}
          saving={saving}
          hasChanges={hasChanges}
        />
      </div>

      {/* Backbone Warning Modal */}
      {showBackboneWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <Card
            variant="solid"
            padding="lg"
            className="border-2 border-red-500/50 max-w-lg w-full shadow-[0_0_50px_rgba(239,68,68,0.2)] space-y-6"
          >
            <div className="flex items-center gap-4 text-red-500">
              <Shield size={32} className="animate-pulse" />
              <Typography variant="h3" color="danger" weight="black" uppercase className="italic">
                {t('AGENTS_CRITICAL_MODIFICATION')}
              </Typography>
            </div>

            <div className="space-y-4 font-mono text-[11px] leading-relaxed">
              <p className="text-white/80">
                <span className="text-red-500 font-bold">{t('AGENTS_BACKBONE_MODIFY_WARNING')}</span>
              </p>
              <div className="bg-red-500/5 border border-red-500/20 p-3 rounded">
                {backboneChanges.map((name) => (
                  <div key={name} className="text-red-400 font-bold">
                    {t('AGENTS_DETECTED_CHANGE').replace('{name}', name)}
                  </div>
                ))}
              </div>
              <p className="text-white/60">
                {t('AGENTS_BACKBONE_WARNING_TEXT')}
              </p>
              <p className="text-white font-bold italic border-l-2 border-red-500 pl-3">
                {t('AGENTS_BACKBONE_RESPONSIBILITY')}
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
                {t('AGENTS_I_UNDERSTAND_PROCEED')}
              </Button>
              <Button
                onClick={() => setShowBackboneWarning(false)}
                variant="outline"
                size="md"
                uppercase
                fullWidth
                className="text-white/60"
              >
                {t('AGENTS_ABORT_MODIFICATION')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* New Agent Modal */}
      <NewAgentModal
        show={showNewAgentModal}
        onClose={() => setShowNewAgentModal(false)}
        newAgent={newAgent}
        setNewAgent={setNewAgent}
        finalizeNewAgent={finalizeNewAgent}
        PROVIDERS={PROVIDERS}
      />

      {/* Agent Tools Modal */}
      <AgentToolsModal
        selectedAgentIdForTools={selectedAgentIdForTools}
        agents={agents}
        allTools={allTools}
        loadingTools={loadingTools}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        setSelectedAgentIdForTools={setSelectedAgentIdForTools}
        handleToggleTool={handleToggleTool}
        isUpdatingTools={isUpdatingTools}
      />
    </main>
  );
}
