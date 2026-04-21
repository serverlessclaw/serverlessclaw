'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  Bot, 
  Settings, 
  History, 
  Play, 
  Save, 
  Zap, 
  ShieldCheck,
  Search,
  Wrench,
  Activity
} from 'lucide-react';
import { toast } from 'sonner';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Agent } from '@/lib/types/ui';
import { TraceSource } from '@claw/core/lib/types/index';
import PlaygroundChat from '@/components/Agent/PlaygroundChat';
import TraceDetailSidebar from '@/components/TraceDetailSidebar';

export default function PlaygroundPage() {
  const searchParams = useSearchParams();
  const agentIdFromUrl = searchParams.get('agentId');
  const traceIdFromUrl = searchParams.get('replayTraceId');
  const suggestedPrompt = searchParams.get('suggestedPrompt');

  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [selectedAgentId, setSelectedAgentId] = useState<string>(agentIdFromUrl || '');
  const [systemPrompt, setSystemPrompt] = useState(suggestedPrompt || '');
  const [loading, setLoading] = useState(true);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAgents() {
      try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        setAgents(data.agents || {});
        if (agentIdFromUrl && data.agents[agentIdFromUrl]) {
          if (!suggestedPrompt) {
            setSystemPrompt(data.agents[agentIdFromUrl].systemPrompt);
          }
        }
      } catch (err) {
        console.error('Failed to fetch agents:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchAgents();
  }, [agentIdFromUrl]);

  const handleAgentChange = (id: string) => {
    setSelectedAgentId(id);
    if (agents[id]) {
      setSystemPrompt(agents[id].systemPrompt);
    }
  };

  const handleSaveToRegistry = async () => {
    if (!selectedAgentId || !agents[selectedAgentId]) return;
    try {
      const res = await fetch(`/api/agents`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          agentId: selectedAgentId, 
          config: { 
            ...agents[selectedAgentId],
            systemPrompt,
            name: agents[selectedAgentId].name // Registry requires name
          } 
        })
      });
      if (res.ok) {
        toast.success("Intelligence Hub: Persona evolution committed to registry.");
      } else {
        const err = await res.json();
        toast.error(`Evolution failed: ${err.error}`);
      }
    } catch (err) {
      toast.error("Failed to connect to Cognitive Registry.");
    }
  };

  return (
    <main className="flex h-screen overflow-hidden bg-background">
      {/* Left Sidebar: Config */}
      <aside className="w-80 border-r border-border flex flex-col bg-card/40 backdrop-blur-xl">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck size={20} className="text-cyber-green" />
            <Typography variant="mono" weight="bold" uppercase className="text-xs tracking-widest">Evolution_Sandbox</Typography>
          </div>

          <div className="space-y-4">
             <div className="space-y-2">
                <Typography variant="mono" color="muted-more" className="text-[9px] uppercase">Target Persona</Typography>
                <select 
                   value={selectedAgentId}
                   onChange={(e) => handleAgentChange(e.target.value)}
                   className="w-full bg-input border border-input rounded p-2 text-xs text-foreground outline-none focus:border-cyber-green/50 transition-colors"
                >
                  <option value="">Select Agent</option>
                  {Object.values(agents).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
             </div>

             <div className="p-3 bg-cyber-blue/5 border border-cyber-blue/20 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Zap size={12} className="text-cyber-blue" />
                  <Typography variant="mono" weight="bold" className="text-[10px] text-cyber-blue">ISOLATED_MODE</Typography>
                </div>
                <Typography variant="caption" color="muted" className="text-[9px] leading-relaxed uppercase">
                  Safety enabled. Memory drift and reflection disabled for this session.
                </Typography>
             </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          <div className="space-y-3">
             <div className="flex items-center justify-between">
                <Typography variant="mono" color="muted-more" className="text-[9px] uppercase font-black tracking-widest">Core Directive</Typography>
                <Badge variant="outline" className="text-[8px] opacity-50 uppercase">v{agents[selectedAgentId]?.version || 1}</Badge>
             </div>
             <textarea 
               value={systemPrompt}
               onChange={(e) => setSystemPrompt(e.target.value)}
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
                Commit to Registry
             </Button>
          </div>

          <div className="space-y-3">
             <Typography variant="mono" color="muted-more" className="text-[9px] uppercase font-black tracking-widest">Active Tools</Typography>
             <div className="space-y-2">
                {agents[selectedAgentId]?.tools?.map(t => (
                  <div key={t} className="flex items-center gap-2 p-2 bg-foreground/[0.02] border border-border rounded">
                     <Wrench size={10} className="text-muted-more" />
                     <Typography variant="mono" color="muted" className="text-[10px]">{t}</Typography>
                  </div>
                ))}
             </div>
          </div>
        </div>
      </aside>

      {/* Main: Chat Area */}
      <section className="flex-1 flex flex-col relative bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-cyber-green/5 via-transparent to-transparent">
        <PlaygroundChat 
          agentId={selectedAgentId} 
          overrideConfig={{ systemPrompt }}
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
