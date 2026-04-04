'use client';

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  Activity,
  Terminal,
  Clock,
  ChevronRight,
  Search,
  Bot,
  Wrench,
  Zap,
  LayoutGrid,
  Cpu,
} from 'lucide-react';
import Link from 'next/link';
import Typography from '@/components/ui/Typography';
import DeleteTraceButton from '@/components/DeleteTraceButton';
import { TRACE_TYPES } from '@claw/core/lib/constants';
import { Trace, TraceStep } from '@/lib/types/ui';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

const CollaborationCanvas = dynamic(() => import('@/components/CollaborationCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center h-96">
      <div className="text-cyber-blue animate-pulse font-mono uppercase text-sm tracking-widest">
        Initializing Collaboration Matrix...
      </div>
    </div>
  ),
});

interface TraceIntelligenceViewProps {
  initialTraces: Trace[];
  sessionTitles?: Record<string, string>;
  initialTab?: TabType;
  nextToken?: string;
}

type TabType = 'timeline' | 'sessions' | 'models' | 'tools' | 'agents' | 'live';

export default function TraceIntelligenceView({
  initialTraces,
  sessionTitles,
  nextToken,
}: TraceIntelligenceViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('timeline');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'started' | 'error'>(
    'all'
  );
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'all' | '24h' | '7d'>('all');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [mountTime, setMountTime] = useState<number>(0);
  const { t } = useTranslations();

  // Capture mount time once to provide stable reference for date filtering
  React.useEffect(() => {
    setMountTime(Date.now());
  }, []);

  // Reset expansion when switching tabs
  React.useEffect(() => {
    setExpandedGroup(null);
  }, [activeTab]);

  // Enhanced trace metadata extraction
  const traces = useMemo(() => {
    return initialTraces.map((trace) => {
      // Extract tools used
      const toolsUsed = trace.steps
        ? Array.from(
            new Set(
              trace.steps
                .filter((s: TraceStep) => s.type === TRACE_TYPES.TOOL_CALL)
                .map((s: TraceStep) => {
                  const toolName = s.content.toolName || '';
                  const tool = s.content.tool || '';
                  return toolName || tool;
                })
            )
          )
        : [];

      // Extract LLM used
      const llmStep = trace.steps?.find((s: TraceStep) => s.type === TRACE_TYPES.LLM_CALL);
      const model =
        trace.initialContext?.model ||
        llmStep?.content?.model ||
        llmStep?.metadata?.model ||
        'UNKNOWN_MODEL';

      // Calculate total tokens
      let totalTokens = 0;
      trace.steps?.forEach((s: TraceStep) => {
        if (s.type === TRACE_TYPES.LLM_RESPONSE && s.content?.usage) {
          const usage = s.content.usage;
          const tokens =
            usage.total_tokens || (usage.totalInputTokens ?? 0) + (usage.totalOutputTokens ?? 0);
          totalTokens += tokens;
        }
      });

      return {
        ...trace,
        toolsUsed,
        model,
        totalTokens,
        sessionId: trace.initialContext?.sessionId ?? 'ANONYMOUS_SESSION',
        agentId: trace.agentId || trace.initialContext?.agentId || 'UNKNOWN_AGENT',
      };
    });
  }, [initialTraces]);

  // Filtering logic
  const filteredTraces = useMemo(() => {
    return traces.filter((trace) => {
      const text = trace.initialContext?.userText || '';
      const matchesSearch =
        trace.traceId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        trace.toolsUsed.some((t: string) => t.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesStatus = statusFilter === 'all' || trace.status === statusFilter;
      const matchesSource = sourceFilter === 'all' || trace.source === sourceFilter;

      let matchesDate = true;
      if (mountTime > 0) {
        if (dateFilter === '24h') {
          matchesDate = mountTime - trace.timestamp < 24 * 60 * 60 * 1000;
        } else if (dateFilter === '7d') {
          matchesDate = mountTime - trace.timestamp < 7 * 24 * 60 * 60 * 1000;
        }
      }

      return matchesSearch && matchesStatus && matchesSource && matchesDate;
    });
  }, [traces, searchQuery, statusFilter, sourceFilter, dateFilter, mountTime]);

  // Grouping logic
  const groupedData = useMemo(() => {
    if (activeTab === 'agents') {
      const groups: Record<string, Trace[]> = {};
      filteredTraces.forEach((t) => {
        if (!groups[t.agentId]) groups[t.agentId] = [];
        groups[t.agentId].push(t);
      });
      return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    }

    if (activeTab === 'sessions') {
      const groups: Record<string, Trace[]> = {};
      filteredTraces.forEach((t) => {
        const displayTitle = sessionTitles?.[t.sessionId]
          ? `${sessionTitles[t.sessionId]} (${t.sessionId.substring(0, 8)}...)`
          : t.sessionId;
        if (!groups[displayTitle]) groups[displayTitle] = [];
        groups[displayTitle].push(t);
      });
      return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    }

    if (activeTab === 'models') {
      const groups: Record<string, Trace[]> = {};
      filteredTraces.forEach((t) => {
        if (!groups[t.model]) groups[t.model] = [];
        groups[t.model].push(t);
      });
      return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    }

    if (activeTab === 'tools') {
      const groups: Record<string, Trace[]> = {};
      filteredTraces.forEach((t) => {
        t.toolsUsed.forEach((tool: string) => {
          if (!groups[tool]) groups[tool] = [];
          groups[tool].push(t);
        });
      });
      return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    }

    return filteredTraces;
  }, [filteredTraces, activeTab, sessionTitles]);

  const renderTraceCard = (trace: Trace) => (
    <div key={trace.traceId} className="relative group">
      <Link
        href={`/trace/${trace.traceId}?t=${trace.timestamp}`}
        className="glass-card p-4 hover:bg-white/[0.05] transition-all cursor-pointer block cyber-border relative overflow-hidden"
      >
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
          <div className="flex items-start md:items-center gap-3 lg:gap-4">
            <div
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                trace.status === 'completed'
                  ? 'text-cyber-green/80 border-cyber-green/20'
                  : trace.status === 'error'
                    ? 'text-red-400/80 border-red-400/20'
                    : 'text-amber-400/80 border-amber-400/20'
              }`}
            >
              {trace.status.toUpperCase()}
            </div>
            <div className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-cyber-blue/20 text-cyber-blue/80 uppercase">
              {trace.source ?? 'UNKNOWN'}
            </div>
            <div className="text-sm font-medium text-white/90 truncate max-w-[200px] md:max-w-md">
              {trace.initialContext?.userText ?? 'System Task'}
            </div>
          </div>
          <div className="flex items-center justify-between md:justify-end gap-3 md:gap-6 text-[11px] text-white/90 pr-14">
            {(trace.totalTokens ?? 0) > 0 && (
              <div className="flex items-center gap-1.5 text-cyber-green/70 font-mono">
                <Zap size={12} /> {trace.totalTokens}{' '}
                <span className="text-[9px] opacity-50 uppercase">TKN</span>
              </div>
            )}
            <div className="flex items-center gap-2 font-mono opacity-60">
              <Clock size={12} /> {new Date(trace.timestamp).toLocaleTimeString()}
            </div>
            <div className="group-hover:text-cyber-green transition-all transform group-hover:translate-x-1">
              <ChevronRight size={18} />
            </div>
          </div>
        </div>

        {/* Tools tags */}
        {trace.toolsUsed && trace.toolsUsed.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {trace.toolsUsed.map((tool: string, i: number) => (
              <span
                key={i}
                className="text-[8px] px-1.5 py-0.5 rounded bg-white/5 border border-white/5 text-white/40 uppercase tracking-tighter"
              >
                {tool}
              </span>
            ))}
          </div>
        )}
      </Link>

      {/* Absolute positioned delete button outside the link area for safety */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center z-20">
        <DeleteTraceButton traceId={trace.traceId} />
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: t('TOTAL_OPERATIONS'),
            value: traces.length,
            icon: Activity,
            color: 'text-cyber-blue',
          },
          {
            label: t('ACTIVE_SESSIONS'),
            value: new Set(traces.map((t) => t.sessionId)).size,
            icon: LayoutGrid,
            color: 'text-purple-400',
          },
          {
            label: t('TOOLS_INVOKED'),
            value: new Set(traces.flatMap((t) => t.toolsUsed)).size,
            icon: Wrench,
            color: 'text-yellow-400',
          },
          {
            label: t('TOKEN_COST'),
            value: `${(traces.reduce((acc, t) => acc + t.totalTokens, 0) / 1000).toFixed(1)}k`,
            icon: Zap,
            color: 'text-cyber-green',
          },
        ].map((stat, i) => (
          <div
            key={i}
            className="glass-card p-4 flex flex-col items-center justify-center border-white/5"
          >
            <stat.icon size={20} className={`${stat.color} mb-2 opacity-80`} />
            <Typography variant="mono" className="text-xl font-black">
              {stat.value}
            </Typography>
            <Typography
              variant="mono"
              color="muted"
              className="text-[9px] uppercase tracking-widest opacity-40 mt-1"
            >
              {stat.label}
            </Typography>
          </div>
        ))}
      </div>

      {/* Tabs & Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-white/5 pb-4">
        <div className="flex p-1 bg-white/5 rounded-lg border border-white/5 overflow-x-auto">
          {[
            { id: 'live', label: t('LIVE'), icon: Activity },
            { id: 'timeline', label: t('TIMELINE'), icon: Clock },
            { id: 'sessions', label: t('SESSIONS'), icon: LayoutGrid },
            { id: 'agents', label: t('AGENTS'), icon: Cpu },
            { id: 'models', label: t('MODELS'), icon: Bot },
            { id: 'tools', label: t('TOOLS'), icon: Wrench },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all duration-300 ${
                activeTab === tab.id
                  ? tab.id === 'live'
                    ? 'bg-cyber-green/10 text-cyber-green border border-cyber-green/20 shadow-[0_0_15px_rgba(0,255,136,0.1)]'
                    : 'bg-cyber-blue/10 text-cyber-blue border border-cyber-blue/20 shadow-[0_0_15px_rgba(0,240,255,0.1)]'
                  : 'text-white/40 hover:text-white/60 hover:bg-white/5'
              }`}
            >
              <tab.icon
                size={tab.id === 'live' ? 12 : 14}
                className={activeTab === tab.id && tab.id === 'live' ? 'animate-pulse' : ''}
              />
              <span className="hidden md:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {activeTab !== 'live' && (
            <>
              <div className="relative group">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 group-focus-within:text-cyber-blue transition-colors"
                />
                <input
                  type="text"
                  placeholder={t('FILTER_NEURAL_PATHS')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyber-blue/50 w-full md:w-64 transition-all"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as 'all' | 'completed' | 'started' | 'error')
                }
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold uppercase text-white/70 focus:outline-none focus:border-cyber-blue/50"
              >
                <option value="all">{t('STATUS_ALL')}</option>
                <option value="completed">{t('STATUS_COMPLETED')}</option>
                <option value="started">{t('STATUS_RUNNING')}</option>
                <option value="error">{t('STATUS_ERROR')}</option>
              </select>

              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold uppercase text-white/70 focus:outline-none focus:border-cyber-blue/50"
              >
                <option value="all">All Sources</option>
                <option value="telegram">Telegram</option>
                <option value="dashboard">Dashboard</option>
                <option value="system">System</option>
              </select>

              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as 'all' | '24h' | '7d')}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold uppercase text-white/70 focus:outline-none focus:border-cyber-blue/50"
              >
                <option value="all">All Time</option>
                <option value="24h">Last 24h</option>
                <option value="7d">Last 7 Days</option>
              </select>
            </>
          )}
        </div>
      </div>

      {/* Content Rendering */}
      <div className="space-y-6">
        {activeTab === 'live' ? (
          <div className="glass-card border-white/5 overflow-hidden flex flex-col">
            <div className="px-6 py-3 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-[0.2em] text-white/70">
                <Zap size={12} className="text-cyber-green" /> Live Agent Dispatches
              </div>
              <div className="flex items-center gap-4 text-[9px] text-white/40">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-cyber-green animate-pulse"></div> RUNNING
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-yellow-500"></div> PENDING
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-cyber-blue"></div> COMPLETED
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div> FAILED
                </div>
              </div>
            </div>
            <div className="h-[600px] relative">
              <CollaborationCanvas />
            </div>
          </div>
        ) : activeTab === 'timeline' ? (
          <div className="grid gap-3">
            {(groupedData as Trace[]).map((trace) => renderTraceCard(trace))}
          </div>
        ) : expandedGroup ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setExpandedGroup(null)}
                  className="p-2 rounded-full hover:bg-white/5 text-white/40 hover:text-white transition-colors border border-white/5"
                >
                  <ChevronRight size={18} className="rotate-180" />
                </button>
                <div>
                  <Typography
                    variant="mono"
                    color="primary"
                    className="text-xs font-black tracking-widest uppercase"
                  >
                    {expandedGroup}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="muted"
                    className="text-[10px] uppercase opacity-50"
                  >
                    Grouped Intelligence Paths
                  </Typography>
                </div>
              </div>
            </div>
            <div className="grid gap-3">
              {(groupedData as Array<[string, Trace[]]>)
                .find(([name]) => name === expandedGroup)?.[1]
                .map((trace: Trace) => renderTraceCard(trace))}
            </div>
          </div>
        ) : (
          <div className="glass-card overflow-hidden border-white/5">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02]">
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/40">
                      {t('NEURAL_GROUP')}
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/40 text-center">
                      {t('TRACES')}
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/40 text-center">
                      {t('RESOURCES')}
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/40 text-center">
                      {t('STATUS')}
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-white/40 text-right">
                      {t('ACTION')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(groupedData as Array<[string, Trace[]]>).map(([groupName, groupTraces]) => {
                    const totalTokens = groupTraces.reduce(
                      (acc, t) => acc + (t.totalTokens || 0),
                      0
                    );
                    const errorCount = groupTraces.filter((t) => t.status === 'error').length;

                    return (
                      <tr key={groupName} className="hover:bg-white/[0.02] transition-colors group">
                        <td className="px-6 py-4">
                          <Typography
                            variant="mono"
                            weight="bold"
                            className="text-xs text-white/90 truncate max-w-[300px]"
                          >
                            {groupName}
                          </Typography>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="text-xs font-mono text-cyber-blue">
                            {groupTraces.length}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-1.5 text-xs font-mono text-cyber-green/70">
                            <Zap size={10} /> {(totalTokens / 1000).toFixed(1)}k
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {errorCount > 0 ? (
                              <div className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20">
                                {errorCount} ERR
                              </div>
                            ) : (
                              <div className="w-2 h-2 rounded-full bg-cyber-green shadow-[0_0_8px_rgba(0,255,163,0.5)]"></div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => setExpandedGroup(groupName)}
                            className="text-[10px] font-black uppercase tracking-widest text-cyber-blue hover:text-white transition-colors bg-cyber-blue/5 hover:bg-cyber-blue/20 px-3 py-1.5 rounded border border-cyber-blue/20"
                          >
                            {t('EXPLORE')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {nextToken && activeTab === 'timeline' && (
          <div className="flex justify-center pt-4">
            <Link
              href={`/trace?nextToken=${nextToken}`}
              className="px-6 py-2 rounded bg-cyber-blue/10 border border-cyber-blue/30 text-cyber-blue text-xs font-bold uppercase tracking-widest hover:bg-cyber-blue/20 transition-colors"
            >
              Load More Traces
            </Link>
          </div>
        )}

        {activeTab !== 'live' && groupedData.length === 0 && (
          <div className="h-40 flex flex-col items-center justify-center text-white/50 border border-dashed border-white/10 rounded-lg bg-white/[0.02]">
            <Terminal size={32} className="mb-3 opacity-20 animate-pulse" />
            <p className="text-[10px] tracking-[0.2em] font-bold">{t('NO_TRACES_FOUND')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
