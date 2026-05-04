'use client';

import React, { useEffect, useState } from 'react';
import { X, Activity, Zap, Clock, Cpu, Bot, Terminal, ChevronRight } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { Trace, TraceStep } from '@/lib/types/ui';
import { TRACE_TYPES } from '@claw/core/lib/constants';
import { logger } from '@claw/core/lib/logger';

interface TraceDetailSidebarProps {
  traceId: string | null;
  onClose: () => void;
  isOpen?: boolean;
}

export default function TraceDetailSidebar({ traceId, onClose, isOpen }: TraceDetailSidebarProps) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!traceId) {
      setTrace(null);
      return;
    }

    async function fetchTrace() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/trace/${traceId}`);
        if (!response.ok) throw new Error('TRACE_FETCH_FAILED');
        const data = await response.json();
        setTrace(data.trace);
      } catch (err) {
        logger.error('Failed to fetch trace details:', err);
        setError('Failed to load trace information');
      } finally {
        setLoading(false);
      }
    }

    fetchTrace();

    // Refresh interval for active traces
    const interval = setInterval(() => {
      if (trace && trace.status !== 'completed' && trace.status !== 'error') {
        fetchTrace();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [traceId, trace]);

  if (!traceId) return null;

  return (
    <div
      className={`
      fixed top-0 right-0 h-full w-[450px] bg-background border-l border-white/10 z-[100] shadow-2xl transition-transform duration-300 transform
      ${traceId || isOpen ? 'translate-x-0' : 'translate-x-full'}
    `}
    >
      <header className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-foreground/[0.02]">
        <div className="flex items-center gap-3">
          <Activity size={18} className="text-cyber-blue" />
          <Typography variant="mono" weight="black" className="text-xs tracking-[0.2em] uppercase">
            Trace_Intelligence
          </Typography>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <X size={20} className="text-white/40" />
        </button>
      </header>

      <div className="h-[calc(100%-64px)] overflow-y-auto p-6 space-y-8 pb-20 scrollbar-thin">
        {loading && !trace ? (
          <div className="flex flex-col items-center justify-center h-40 gap-4 opacity-50">
            <Cpu size={32} className="animate-spin text-cyber-blue" />
            <Typography variant="mono" className="text-[10px] uppercase tracking-widest">
              Synchronizing_Traces...
            </Typography>
          </div>
        ) : error ? (
          <div className="text-center py-10">
            <Typography variant="body" color="muted">
              {error}
            </Typography>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.location.reload()}
              className="mt-4"
            >
              Retry
            </Button>
          </div>
        ) : trace ? (
          <>
            {/* Trace Overview Header */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <Badge
                  variant={
                    trace.status === 'completed'
                      ? 'primary'
                      : trace.status === 'error'
                        ? 'danger'
                        : 'warning'
                  }
                  className="uppercase font-black text-[9px] px-2 py-0.5"
                >
                  {trace.status}
                </Badge>
                <Typography variant="mono" className="text-[9px] text-white/20 uppercase">
                  {trace.traceId}
                </Typography>
              </div>
              <Typography variant="h3" color="white" uppercase glow className="leading-tight">
                {trace.initialContext?.userText || 'Internal System Task'}
              </Typography>

              <div className="grid grid-cols-2 gap-4">
                <Card variant="glass" padding="sm" className="bg-foreground/[0.02] border-white/5">
                  <Typography variant="mono" className="text-[9px] uppercase opacity-40 mb-1">
                    Total Tokens
                  </Typography>
                  <div className="flex items-center gap-2 text-cyber-green text-sm font-black">
                    <Zap size={14} /> {(trace.totalTokens || 0).toLocaleString()}
                  </div>
                </Card>
                <Card variant="glass" padding="sm" className="bg-foreground/[0.02] border-white/5">
                  <Typography variant="mono" className="text-[9px] uppercase opacity-40 mb-1">
                    Latency
                  </Typography>
                  <div className="flex items-center gap-2 text-white/80 text-sm font-black">
                    <Clock size={14} /> {trace.durationMs || 0}ms
                  </div>
                </Card>
              </div>
            </section>

            {/* Agent / Model info */}
            <section className="space-y-3 pt-6 border-t border-white/5">
              <div className="flex items-center gap-2 text-[10px] uppercase font-black text-white/40 tracking-widest">
                <Bot size={12} /> Execution Unit
              </div>
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                <div className="flex flex-col">
                  <Typography variant="mono" className="text-[11px] font-bold text-cyber-blue">
                    {trace.agentId}
                  </Typography>
                  <Typography variant="mono" className="text-[9px] opacity-40 uppercase">
                    Assigned Agent
                  </Typography>
                </div>
                <Badge
                  variant="outline"
                  className="text-[9px] border-white/10 uppercase font-bold text-white/50"
                >
                  {trace.model || 'Unknown Model'}
                </Badge>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full text-[10px] uppercase font-bold tracking-widest border-cyber-green/20 text-cyber-green/80 hover:bg-cyber-green/5 mt-2"
                onClick={() => {
                  window.location.href = `/playground?agentId=${trace.agentId}&replayTraceId=${trace.traceId}`;
                }}
                icon={<Zap size={14} />}
              >
                Replay in Sandbox
              </Button>
            </section>

            {/* Neural Execution Steps */}
            <section className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-[10px] uppercase font-black text-white/40 tracking-widest">
                  <Terminal size={12} /> Neural Steps
                </div>
                <Typography variant="mono" className="text-[9px] opacity-20 uppercase font-black">
                  {trace.steps?.length || 0} Events
                </Typography>
              </div>

              <div className="space-y-3 relative">
                <div className="absolute left-4 top-4 bottom-4 w-px bg-white/5 z-0" />
                {trace.steps?.map((step: TraceStep, i: number) => (
                  <div key={i} className="relative z-10 pl-10 group">
                    <div
                      className={`
                            absolute left-2.5 top-1.5 w-3 h-3 rounded-full border-2 border-background
                            ${
                              step.type === TRACE_TYPES.TOOL_CALL
                                ? 'bg-amber-400'
                                : step.type === TRACE_TYPES.LLM_CALL
                                  ? 'bg-cyber-blue'
                                  : step.type === TRACE_TYPES.LLM_RESPONSE
                                    ? 'bg-cyber-green'
                                    : 'bg-white/20'
                            }
                        `}
                    />
                    <div className="bg-foreground/[0.03] border border-white/5 p-4 rounded-xl group-hover:bg-foreground/[0.06] transition-all group-hover:border-white/10">
                      <div className="flex items-center justify-between mb-2">
                        <Typography
                          variant="mono"
                          className="text-[10px] uppercase font-black tracking-widest opacity-60"
                        >
                          {step.type.split('_').pop()}
                        </Typography>
                        <Typography variant="mono" className="text-[9px] opacity-20">
                          {new Date(step.timestamp).toISOString().slice(14, 21)}
                        </Typography>
                      </div>
                      <Typography
                        variant="body"
                        className="text-[11px] leading-relaxed text-foreground/80 line-clamp-3 italic"
                      >
                        {typeof step.content === 'string'
                          ? step.content
                          : JSON.stringify(step.content).substring(0, 100)}
                      </Typography>
                      <button className="mt-3 flex items-center gap-1 text-[9px] uppercase font-black text-cyber-blue opacity-0 group-hover:opacity-100 transition-opacity">
                        View Details <ChevronRight size={10} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : (
          <div className="text-center py-20 opacity-20">
            <Typography variant="h3" uppercase>
              Select a neuron to examine
            </Typography>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <footer className="absolute bottom-0 left-0 w-full px-6 py-4 bg-background border-t border-white/10 flex items-center justify-between">
        <Typography variant="mono" className="text-[9px] uppercase font-black opacity-20">
          TRACE_CONTEXT_BINDING: ACTIVE
        </Typography>
        <div className="flex items-center gap-1 text-[9px] uppercase font-black text-cyber-green animate-pulse">
          <div className="w-1.5 h-1.5 rounded-full bg-cyber-green" /> Live
        </div>
      </footer>
    </div>
  );
}
