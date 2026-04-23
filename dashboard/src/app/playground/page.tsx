'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Save, Zap, ShieldCheck, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Agent } from '@/lib/types/ui';
import PlaygroundChat from '@/components/Agent/PlaygroundChat';
import TraceDetailSidebar from '@/components/TraceDetailSidebar';

export default function PlaygroundPage() {
  const searchParams = useSearchParams();
  const agentIdFromUrl = searchParams.get('agentId');
  const traceIdFromUrl = searchParams.get('replayTraceId');
  const suggestedPrompt = searchParams.get('suggestedPrompt');

  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(
    agentIdFromUrl ? [agentIdFromUrl] : []
  );
  const [activePromptAgentId, setActivePromptAgentId] = useState<string>(agentIdFromUrl || '');
  const [systemPromptOverrides, setSystemPromptOverrides] = useState<Record<string, string>>({});
  const [, setLoading] = useState(true);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAgents() {
      try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        const allAgents = data.agents || {};
        setAgents(allAgents);

        if (agentIdFromUrl && allAgents[agentIdFromUrl]) {
          setActivePromptAgentId(agentIdFromUrl);
          if (suggestedPrompt) {
            setSystemPromptOverrides((prev) => ({ ...prev, [agentIdFromUrl]: suggestedPrompt }));
          } else {
            setSystemPromptOverrides((prev) => ({
              ...prev,
              [agentIdFromUrl]: allAgents[agentIdFromUrl].systemPrompt,
            }));
          }
        }
      } catch (err) {
        console.error('Failed to fetch agents:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchAgents();
  }, [agentIdFromUrl, suggestedPrompt]);

  const toggleAgentSelection = (id: string) => {
    setSelectedAgentIds((prev) => {
      const isSelected = prev.includes(id);
      let next: string[];
      if (isSelected) {
        next = prev.filter((aid) => aid !== id);
        if (activePromptAgentId === id) {
          setActivePromptAgentId(next[0] || '');
        }
      } else {
        next = [...prev, id];
        if (!activePromptAgentId) setActivePromptAgentId(id);
        // Initialize override if not present
        if (!systemPromptOverrides[id] && agents[id]) {
          setSystemPromptOverrides((overrides) => ({
            ...overrides,
            [id]: agents[id].systemPrompt,
          }));
        }
      }
      return next;
    });
  };

  const handleSaveToRegistry = async () => {
    const agentId = activePromptAgentId;
    const systemPrompt = systemPromptOverrides[agentId];
    if (!agentId || !agents[agentId] || !systemPrompt) return;

    try {
      const res = await fetch(`/api/agents`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          config: {
            ...agents[agentId],
            systemPrompt,
            name: agents[agentId].name,
          },
        }),
      });
      if (res.ok) {
        toast.success(`Registry updated: ${agents[agentId].name} persona evolved.`);
      } else {
        const _err = await res.json();
        toast.error(`Evolution failed: ${_err.error}`);
      }
    } catch {
      toast.error('Failed to connect to Cognitive Registry.');
    }
  };

  return (
    <main className="flex h-screen overflow-hidden bg-background">
      {/* Left Sidebar: Config */}
      <aside className="w-80 border-r border-border flex flex-col bg-card/40 backdrop-blur-xl">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck size={20} className="text-cyber-green" />
            <Typography variant="mono" weight="bold" uppercase className="text-xs tracking-widest">
              Swarm_Simulation_Sandbox
            </Typography>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Typography variant="mono" color="muted-more" className="text-[9px] uppercase">
                Swarm Team
              </Typography>
              <div className="max-h-40 overflow-y-auto space-y-1 p-2 bg-input/50 border border-input rounded custom-scrollbar">
                {Object.values(agents).map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-2 px-1 py-1 hover:bg-foreground/5 rounded cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAgentIds.includes(a.id)}
                      onChange={() => toggleAgentSelection(a.id)}
                      className="w-3 h-3 rounded border-gray-300 text-cyber-green focus:ring-cyber-green bg-transparent"
                    />
                    <Typography variant="mono" className="text-[10px] truncate">
                      {a.name}
                    </Typography>
                  </label>
                ))}
              </div>
            </div>

            <div className="p-3 bg-cyber-blue/5 border border-cyber-blue/20 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <Zap size={12} className="text-cyber-blue" />
                <Typography variant="mono" weight="bold" className="text-[10px] text-cyber-blue">
                  SIMULATION_MODE
                </Typography>
              </div>
              <Typography
                variant="caption"
                color="muted"
                className="text-[9px] leading-relaxed uppercase"
              >
                Multi-agent isolation enabled. Agents can coordinate but results are ephemeral.
              </Typography>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {selectedAgentIds.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-1 border-b border-white/5 mb-4 overflow-x-auto no-scrollbar">
                {selectedAgentIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => setActivePromptAgentId(id)}
                    className={`px-3 py-1.5 text-[9px] uppercase font-bold tracking-widest transition-all ${
                      activePromptAgentId === id
                        ? 'text-cyber-green border-b border-cyber-green bg-cyber-green/5'
                        : 'text-muted-more hover:text-foreground'
                    }`}
                  >
                    {agents[id]?.name || id}
                  </button>
                ))}
              </div>

              {activePromptAgentId && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="flex items-center justify-between">
                    <Typography
                      variant="mono"
                      color="muted-more"
                      className="text-[9px] uppercase font-black tracking-widest"
                    >
                      Core Directive
                    </Typography>
                    <Badge variant="outline" className="text-[8px] opacity-50 uppercase">
                      v{agents[activePromptAgentId]?.version || 1}
                    </Badge>
                  </div>
                  <textarea
                    value={systemPromptOverrides[activePromptAgentId] || ''}
                    onChange={(e) =>
                      setSystemPromptOverrides((prev) => ({
                        ...prev,
                        [activePromptAgentId]: e.target.value,
                      }))
                    }
                    className="w-full h-80 bg-input border border-input rounded p-3 text-[11px] font-mono text-foreground/80 outline-none focus:border-cyber-green/30 custom-scrollbar resize-none transition-colors"
                    placeholder="System instructions..."
                  />
                  <Button
                    onClick={handleSaveToRegistry}
                    variant="outline"
                    size="sm"
                    className="w-full text-[10px] uppercase font-bold tracking-widest border-cyber-green/20 text-cyber-green/80 hover:bg-cyber-green/5"
                    icon={<Save size={14} />}
                  >
                    Commit {agents[activePromptAgentId]?.name} to Registry
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center opacity-20 text-center px-4">
              <Wrench size={32} className="mb-2" />
              <Typography variant="mono" className="text-[10px] uppercase">
                Select agents to configure swarm team
              </Typography>
            </div>
          )}

          {activePromptAgentId && (
            <div className="space-y-3 border-t border-white/5 pt-6">
              <Typography
                variant="mono"
                color="muted-more"
                className="text-[9px] uppercase font-black tracking-widest"
              >
                Available Tools
              </Typography>
              <div className="flex flex-wrap gap-1">
                {agents[activePromptAgentId]?.tools?.map((t) => (
                  <div
                    key={t}
                    className="flex items-center gap-1.5 px-2 py-1 bg-foreground/[0.02] border border-border rounded text-[9px] text-muted mono"
                  >
                    <Wrench size={8} className="text-muted-more/40" />
                    {t}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main: Chat Area */}
      <section className="flex-1 flex flex-col relative bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-cyber-green/5 via-transparent to-transparent">
        <PlaygroundChat
          agentIds={selectedAgentIds}
          promptOverrides={systemPromptOverrides}
          onTraceUpdate={(traceId) => {
            setActiveTraceId(traceId);
            setIsTraceOpen(true);
          }}
          replayTraceId={traceIdFromUrl || undefined}
        />
      </section>

      {/* Right Sidebar: Trace (Optional Overlay) */}
      <TraceDetailSidebar
        traceId={activeTraceId}
        onClose={() => setIsTraceOpen(false)}
        isOpen={isTraceOpen}
      />
    </main>
  );
}
