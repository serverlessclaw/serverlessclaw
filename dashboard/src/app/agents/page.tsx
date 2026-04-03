'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Shield, RefreshCw, Radio } from 'lucide-react';
import { THEME } from '@/lib/theme';
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
import { useRealtime, RealtimeMessage } from '@/hooks/useRealtime';

// Agent interface moved to ui.ts

const PROVIDERS = {
  openai: {
    label: 'OpenAI (Native)',
    models: ['gpt-5.4', 'gpt-5.4-mini'],
  },
  bedrock: {
    label: 'AWS Bedrock (Native)',
    models: ['global.anthropic.claude-sonnet-4-6'],
  },
  minimax: {
    label: 'MiniMax (Native)',
    models: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
  },
  openrouter: {
    label: 'OpenRouter (Aggregator)',
    models: ['zhipu/glm-5', 'google/gemini-3-flash-preview'],
  },
};

/** AgentsPage — manages the Neural Agent Registry: configure agent personas, toggle tool scopes, and register new dynamic agents without redeploying. */
export default function AgentsPage() {
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
  const [isUpdatingTools, setIsUpdatingTools] = useState(false);
  const [reputation, setReputation] = useState<Record<string, { successRate: number; avgLatencyMs: number; tasksCompleted: number; tasksFailed: number }>>({});

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    agentId: string;
    agentName: string;
  }>({
    isOpen: false,
    agentId: '',
    agentName: '',
  });
  
  const loadAgents = async () => {
    setLoading(true);
    try {
      const agentsRes = await fetch('/api/agents');
      const agentsData = await agentsRes.json();
      setAgents(agentsData);
      setInitialAgents(JSON.parse(JSON.stringify(agentsData)));
    } catch (err) {
      console.error('Failed to load agents:', err);
      toast.error('Failed to synchronize with agent registry');
    } finally {
      setLoading(false);
    }
  };

  const loadTools = async (forceRefresh = false) => {
    if (forceRefresh) setRefreshingTools(true);
    else setLoadingTools(true);
    
    try {
      const toolsRes = await fetch(`/api/tools${forceRefresh ? '?refresh=true' : ''}`);
      const toolsData = await toolsRes.json();
      setAllTools(toolsData.tools || []);
      if (forceRefresh) toast.success('Tool cache synchronized');
    } catch (err) {
      console.error('Failed to load tools:', err);
      toast.error('Failed to synchronize tool registry');
    } finally {
      setLoadingTools(false);
      setRefreshingTools(false);
    }
  };

  const syncRegistry = async () => {
    setRefreshingTools(true);
    try {
      await Promise.all([loadAgents(), loadTools(true)]);
      toast.success('Agent registry and tool cache synchronized');
    } catch (err) {
      console.error('Sync failed:', err);
      toast.error('Failed to synchronize registry');
    } finally {
      setRefreshingTools(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    if (selectedAgentIdForTools && allTools.length === 0 && !loadingTools) {
      loadTools();
    }
  }, [selectedAgentIdForTools, allTools.length, loadingTools]);

  const loadReputation = async () => {
    try {
      const res = await fetch('/api/reputation');
      const data = await res.json();
      setReputation(data);
    } catch (err) {
      console.error('Failed to load reputation:', err);
    }
  };

  useEffect(() => {
    loadReputation();
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
          agent.reasoningProfile !== initial.reasoningProfile ||
          agent.enabled !== initial.enabled
        );
      }).map(a => a.name ?? a.id);

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
      console.error('Failed to save agent configuration:', err);
      toast.error('Failed to save agent configuration');
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
      tools: [],
    });
  };

  const finalizeNewAgent = () => {
    if (!newAgent.id || !newAgent.name) {
        toast.error('Agent ID and Name are required.');
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
      ? agent.tools.filter(t => t !== toolName)
      : [...agent.tools, toolName];

    // Optimistic Update
    setAgents((prev: Record<string, Agent>) => ({
      ...prev,
      [agentId]: { ...prev[agentId], tools: newTools }
    }));

    setIsUpdatingTools(true);
    try {
      const { updateAgentTools } = await import('@/app/capabilities/actions');
      const formData = new FormData();
      formData.append('agentId', agentId);
      newTools.forEach(t => formData.append('tools', t));
      
      const result = await updateAgentTools(formData);
      if (result?.error) throw new Error(result.error);
      
      toast.success(`Agent tools updated`);
    } catch (err) {
      console.error('Failed to update tools:', err);
      toast.error('Failed to update tools');
      // Revert
      setAgents(prev => ({
        ...prev,
        [agentId]: { ...prev[agentId], tools: initialAgents[agentId]?.tools ?? [] }
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
    toast.success(`Agent '${confirmModal.agentName}' decommissioned`);
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
      console.log(`[Realtime] Refreshing agents due to: ${type}`);
      loadAgents();
      loadReputation();
    }
  }, []);

  // Use Realtime Hook for live updates
  const { isConnected } = useRealtime({
    topics: ['agents/+/signal', 'system/+/signal'],
    onMessage: handleRealtimeMessage
  });

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
          <div className="flex items-center gap-3">
            <Typography variant="h2" color="white" glow uppercase>
              Agents
            </Typography>
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-widest font-bold ${isConnected ? 'bg-cyber-green/10 text-cyber-green border border-cyber-green/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
              <Radio size={10} className={isConnected ? 'animate-pulse' : ''} />
              {isConnected ? 'LIVE' : 'OFFLINE'}
            </div>
          </div>
          <Typography variant="body" color="muted" className="mt-2 block">
            Manage backbone orchestrators and specialized autonomous agents.
          </Typography>
        </div>
        <div className="flex gap-4 items-end">
            <div className="flex flex-col items-center">
                <Typography variant="mono" color="muted" className="text-[10px] uppercase tracking-widest opacity-40 mb-1">NODES</Typography>
                <Badge variant="outline" className={`px-4 py-1 font-bold text-xs border-${THEME.COLORS.INTEL}/20 text-${THEME.COLORS.INTEL}/60 uppercase`}>{Object.keys(agents).length}</Badge>
            </div>
            <Button
              onClick={syncRegistry}
              variant="outline"
              size="sm"
              disabled={refreshingTools}
              icon={<RefreshCw size={14} className={refreshingTools ? 'animate-spin' : ''} />}
              className="h-[34px] uppercase font-black tracking-widest border-white/5 hover:bg-white/5"
            >
              {refreshingTools ? 'Syncing...' : 'Sync Registry'}
            </Button>
            <Button
              onClick={addAgent}
              variant="outline"
              size="sm"
              icon={<Plus size={14} />}
              className="h-[34px] uppercase font-black tracking-widest"
            >
              New Agent
            </Button>
        </div>
      </header>

      <div className="max-w-6xl space-y-8 pb-20">
        <AgentTable
          agents={agents}
          reputation={reputation}
          updateAgent={updateAgent}
          deleteAgent={deleteAgent}
          setSelectedAgentIdForTools={setSelectedAgentIdForTools}
          onSave={() => handleSave()}
          saving={saving}
          hasChanges={hasChanges}
        />
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
                Backbone agents are critical to the system&apos;s connectivity and core logic. 
                Unauthorized or incorrect modifications can lead to cascading failures, deadlocked tasks, 
                or loss of system autonomy.
              </p>
              <p className="text-white font-bold italic border-l-2 border-red-500 pl-3">
                &quot;I understand that these changes affect the system&apos;s fundamental architecture and I take full responsibility for this modification.&quot;
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
