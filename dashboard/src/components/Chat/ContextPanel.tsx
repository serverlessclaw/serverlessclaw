'use client';

import React, { useState, useEffect } from 'react';
import { Activity, Brain, X, Zap, Database, Terminal, Cpu, Wrench } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { Trace } from '@/lib/types/ui';
import { TRACE_TYPES } from '@claw/core/lib/constants';

interface ContextPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
}

interface MemoryFragment {
  type?: string;
  timestamp: number;
  content: string;
}

/**
 * ContextPanel - Provides real-time intelligence about the current session.
 * Displays "Live Trace" (reasoning/tools) and "Active Memory" (vault context).
 */
export const ContextPanel: React.FC<ContextPanelProps> = ({ isOpen, onClose, sessionId }) => {
  const { t } = useTranslations();
  const [activeTab, setActiveTab] = useState<'trace' | 'memory'>('trace');
  const [traces, setTraces] = useState<Trace[]>([]);
  const [memoryFragments, setMemoryFragments] = useState<MemoryFragment[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !sessionId) return;

    // Initial fetch of traces for the session
    const fetchSessionContext = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/chat/context?sessionId=${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          setTraces(data.traces || []);
          setMemoryFragments(data.memory || []);
        }
      } catch (err) {
        console.error('Failed to fetch session context:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSessionContext();
  }, [isOpen, sessionId]);

  if (!isOpen) return null;

  return (
    <aside className="w-80 border-l border-border bg-background flex flex-col h-full animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between bg-foreground/[0.02]">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-cyber-green" />
          <Typography
            variant="mono"
            weight="bold"
            className="text-xs uppercase tracking-widest text-cyber-green"
          >
            Intel_Context
          </Typography>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-foreground/5 rounded-full transition-colors text-muted-foreground hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex p-1 bg-foreground/[0.02] border-b border-border">
        <button
          onClick={() => setActiveTab('trace')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-[10px] font-bold uppercase transition-all ${
            activeTab === 'trace'
              ? 'bg-cyber-blue/10 text-cyber-blue shadow-premium border border-cyber-blue/20'
              : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
          }`}
        >
          <Activity size={12} />
          {t('LIVE')}
        </button>
        <button
          onClick={() => setActiveTab('memory')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-[10px] font-bold uppercase transition-all ${
            activeTab === 'memory'
              ? 'bg-purple-500/10 text-purple-400 shadow-premium border border-purple-500/20'
              : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
          }`}
        >
          <Database size={12} />
          {t('MEMORY_RESERVE')}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 custom-scrollbar">
        {isLoading ? (
          <div className="h-40 flex flex-col items-center justify-center gap-3">
            <div className="w-6 h-6 border-2 border-cyber-green/20 border-t-cyber-green rounded-full animate-spin" />
            <Typography
              variant="mono"
              className="text-[9px] uppercase tracking-widest text-muted-foreground"
            >
              Syncing_Neural_State...
            </Typography>
          </div>
        ) : activeTab === 'trace' ? (
          <TraceList traces={traces} />
        ) : (
          <MemoryList fragments={memoryFragments} />
        )}
      </div>

      {/* Footer / System Stats */}
      <div className="p-3 border-t border-border bg-foreground/[0.02] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-cyber-green animate-pulse" />
          <Typography
            variant="mono"
            className="text-[9px] uppercase font-bold text-muted-foreground"
          >
            {t('SYSTEM_ONLINE')}
          </Typography>
        </div>
        <Typography variant="mono" className="text-[9px] text-muted-foreground opacity-50">
          v5.4.1_Intel
        </Typography>
      </div>
    </aside>
  );
};

const TraceList = ({ traces }: { traces: Trace[] }) => {
  if (traces.length === 0) {
    return (
      <div className="py-12 text-center space-y-3 opacity-50">
        <Terminal size={24} className="mx-auto" />
        <Typography variant="mono" className="text-[10px] uppercase font-bold">
          No live events detected
        </Typography>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {traces.map((trace) => (
        <div key={trace.traceId} className="space-y-2">
          <div className="flex items-center gap-2">
            <Typography
              variant="mono"
              className="text-[9px] font-black text-cyber-blue uppercase tracking-tighter"
            >
              {trace.traceId.substring(0, 8)}
            </Typography>
            <div
              className={`text-[8px] px-1 rounded-sm border ${trace.status === 'completed' ? 'border-cyber-green/20 text-cyber-green/70' : 'border-amber-400/20 text-amber-400/70'}`}
            >
              {trace.status.toUpperCase()}
            </div>
          </div>

          <div className="space-y-1.5 border-l border-border pl-3 ml-1.5">
            {trace.steps?.map((step, idx) => (
              <div key={idx} className="group relative">
                <div className="absolute -left-[14.5px] top-1.5 w-1.5 h-1.5 rounded-full bg-border group-hover:bg-cyber-blue transition-colors" />
                <div className="flex items-start gap-2">
                  {step.type === TRACE_TYPES.TOOL_CALL ? (
                    <Wrench size={10} className="mt-0.5 text-yellow-400" />
                  ) : step.type === TRACE_TYPES.LLM_CALL ? (
                    <Cpu size={10} className="mt-0.5 text-cyber-blue" />
                  ) : (
                    <Zap size={10} className="mt-0.5 text-purple-400" />
                  )}
                  <Typography className="text-[10px] leading-tight text-foreground/80 lowercase">
                    {step.stepId}
                  </Typography>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const MemoryList = ({ fragments }: { fragments: MemoryFragment[] }) => {
  if (fragments.length === 0) {
    return (
      <div className="py-12 text-center space-y-3 opacity-50">
        <Database size={24} className="mx-auto" />
        <Typography variant="mono" className="text-[10px] uppercase font-bold">
          No active context recalled
        </Typography>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {fragments.map((fragment, idx) => (
        <div
          key={idx}
          className="glass-card p-2 border-border text-[10px] space-y-1 hover:border-purple-500/30 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <Typography variant="mono" className="text-[8px] font-black text-purple-400 uppercase">
              {fragment.type || 'Fact'}
            </Typography>
            <Typography variant="mono" className="text-[8px] text-muted-foreground">
              {new Date(fragment.timestamp).toLocaleDateString()}
            </Typography>
          </div>
          <Typography className="text-foreground/80 line-clamp-3 leading-snug">
            {fragment.content}
          </Typography>
        </div>
      ))}
    </div>
  );
};
