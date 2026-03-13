'use client';

import React, { useState, useMemo } from 'react';
import { 
  Activity, 
  Terminal, 
  Clock, 
  ChevronRight, 
  Search, 
  Filter, 
  LayoutGrid, 
  Bot, 
  Wrench, 
  Zap,
  Layers,
  Calendar,
  BarChart3
} from 'lucide-react';
import Link from 'next/link';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import DeleteTraceButton from '@/components/DeleteTraceButton';
import { TRACE_TYPES } from '@/lib/constants';

interface TraceIntelligenceViewProps {
  initialTraces: any[];
}

type TabType = 'timeline' | 'sessions' | 'models' | 'tools' | 'usage';

export default function TraceIntelligenceView({ initialTraces }: TraceIntelligenceViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('timeline');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'started' | 'error'>('all');

  // Enhanced trace metadata extraction
  const traces = useMemo(() => {
    return initialTraces.map(trace => {
      // Extract tools used
      const toolsUsed = trace.steps
        ? Array.from(new Set(
            trace.steps
              .filter((s: any) => s.type === TRACE_TYPES.TOOL_CALL)
              .map((s: any) => s.content.toolName || s.content.tool)
          ))
        : [];

      // Extract LLM used
      const llmStep = trace.steps?.find((s: any) => s.type === TRACE_TYPES.LLM_CALL);
      const model = trace.initialContext?.model || llmStep?.content?.model || llmStep?.metadata?.model || 'UNKNOWN_MODEL';

      // Calculate total tokens
      let totalTokens = 0;
      trace.steps?.forEach((s: any) => {
        if (s.type === TRACE_TYPES.LLM_RESPONSE && s.content.usage) {
          totalTokens += s.content.usage.total_tokens || 0;
        }
      });

      return {
        ...trace,
        toolsUsed,
        model,
        totalTokens,
        sessionId: trace.initialContext?.sessionId || 'ANONYMOUS_SESSION'
      };
    });
  }, [initialTraces]);

  // Filtering logic
  const filteredTraces = useMemo(() => {
    return traces.filter(trace => {
      const matchesSearch = 
        trace.traceId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (trace.initialContext?.userText || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        trace.toolsUsed.some((t: string) => t.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesStatus = statusFilter === 'all' || trace.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });
  }, [traces, searchQuery, statusFilter]);

  // Grouping logic
  const groupedData = useMemo(() => {
    if (activeTab === 'sessions') {
      const groups: Record<string, any[]> = {};
      filteredTraces.forEach(t => {
        if (!groups[t.sessionId]) groups[t.sessionId] = [];
        groups[t.sessionId].push(t);
      });
      return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    }
    
    if (activeTab === 'models') {
      const groups: Record<string, any[]> = {};
      filteredTraces.forEach(t => {
        if (!groups[t.model]) groups[t.model] = [];
        groups[t.model].push(t);
      });
      return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    }

    if (activeTab === 'tools') {
      const groups: Record<string, any[]> = {};
      filteredTraces.forEach(t => {
        t.toolsUsed.forEach((tool: string) => {
          if (!groups[tool]) groups[tool] = [];
          groups[tool].push(t);
        });
      });
      return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    }

    if (activeTab === 'usage') {
      return [...filteredTraces].sort((a, b) => b.totalTokens - a.totalTokens);
    }

    return filteredTraces;
  }, [filteredTraces, activeTab]);

  const renderTraceCard = (trace: any) => (
    <Link 
      key={trace.traceId} 
      href={`/trace/${trace.traceId}?t=${trace.timestamp}`}
      className="glass-card p-4 hover:bg-white/[0.05] transition-all cursor-pointer group cyber-border block relative overflow-hidden"
    >
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
        <div className="flex items-start md:items-center gap-3 lg:gap-4">
          <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
            trace.status === 'completed' ? 'text-cyber-green/80 border-cyber-green/20' : 
            trace.status === 'error' ? 'text-red-400/80 border-red-400/20' :
            'text-amber-400/80 border-amber-400/20'
          }`}>
            {trace.status.toUpperCase()}
          </div>
          <div className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-cyber-blue/20 text-cyber-blue/80 uppercase">
            {trace.source || 'UNKNOWN'}
          </div>
          <div className="text-sm font-medium text-white/90 truncate max-w-[200px] md:max-w-md">
            {trace.initialContext?.userText || 'System Task'}
          </div>
        </div>
        <div className="flex items-center justify-between md:justify-end gap-3 md:gap-6 text-[11px] text-white/90">
          {trace.totalTokens > 0 && (
            <div className="flex items-center gap-1.5 text-cyber-green/70 font-mono">
              <Zap size={12} /> {trace.totalTokens} <span className="text-[9px] opacity-50 uppercase">TKN</span>
            </div>
          )}
          <div className="flex items-center gap-2 font-mono opacity-60">
            <Clock size={12} /> {new Date(trace.timestamp).toLocaleTimeString()}
          </div>
          <div className="flex items-center gap-2">
            <DeleteTraceButton traceId={trace.traceId} />
            <div className="group-hover:text-cyber-green transition-all transform group-hover:translate-x-1">
              <ChevronRight size={18} />
            </div>
          </div>
        </div>
      </div>
      
      {/* Tools tags */}
      {trace.toolsUsed.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {trace.toolsUsed.map((tool: string, i: number) => (
            <span key={i} className="text-[8px] px-1.5 py-0.5 rounded bg-white/5 border border-white/5 text-white/40 uppercase tracking-tighter">
              {tool}
            </span>
          ))}
        </div>
      )}
    </Link>
  );

  return (
    <div className="space-y-8">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Operations', value: traces.length, icon: Activity, color: 'text-cyber-blue' },
          { label: 'Active Sessions', value: new Set(traces.map(t => t.sessionId)).size, icon: LayoutGrid, color: 'text-purple-400' },
          { label: 'Tools Invoked', value: new Set(traces.flatMap(t => t.toolsUsed)).size, icon: Wrench, color: 'text-yellow-400' },
          { label: 'Neural Cost', value: `${(traces.reduce((acc, t) => acc + t.totalTokens, 0) / 1000).toFixed(1)}k`, icon: Zap, color: 'text-cyber-green' },
        ].map((stat, i) => (
          <div key={i} className="glass-card p-4 flex flex-col items-center justify-center border-white/5">
            <stat.icon size={20} className={`${stat.color} mb-2 opacity-80`} />
            <Typography variant="mono" className="text-xl font-black">{stat.value}</Typography>
            <Typography variant="mono" color="muted" className="text-[9px] uppercase tracking-widest opacity-40 mt-1">{stat.label}</Typography>
          </div>
        ))}
      </div>

      {/* Tabs & Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-white/5 pb-4">
        <div className="flex p-1 bg-white/5 rounded-lg border border-white/5">
          {[
            { id: 'timeline', label: 'Timeline', icon: Clock },
            { id: 'sessions', label: 'Sessions', icon: LayoutGrid },
            { id: 'models', label: 'Models', icon: Bot },
            { id: 'tools', label: 'Tools', icon: Wrench },
            { id: 'usage', label: 'Usage', icon: BarChart3 },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all duration-300 ${
                activeTab === tab.id 
                  ? 'bg-cyber-blue/10 text-cyber-blue border border-cyber-blue/20 shadow-[0_0_15px_rgba(0,240,255,0.1)]' 
                  : 'text-white/40 hover:text-white/60 hover:bg-white/5'
              }`}
            >
              <tab.icon size={14} />
              <span className="hidden md:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="relative group">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 group-focus-within:text-cyber-blue transition-colors" />
            <input 
              type="text"
              placeholder="Filter neural paths..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-cyber-blue/50 w-full md:w-64 transition-all"
            />
          </div>

          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold uppercase text-white/70 focus:outline-none focus:border-cyber-blue/50"
          >
            <option value="all">ALL_STATUS</option>
            <option value="completed">COMPLETED</option>
            <option value="started">RUNNING</option>
            <option value="error">ERROR</option>
          </select>
        </div>
      </div>

      {/* Content Rendering */}
      <div className="space-y-6">
        {activeTab === 'timeline' || activeTab === 'usage' ? (
          <div className="grid gap-3">
            {(groupedData as any[]).map(trace => renderTraceCard(trace))}
          </div>
        ) : (
          <div className="space-y-8">
            {(groupedData as [string, any[]][]).map(([groupName, groupTraces]) => (
              <div key={groupName} className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                  <Typography variant="mono" color="primary" className="text-[10px] font-black tracking-[0.3em] uppercase opacity-80">
                    {groupName} <span className="text-white/30 ml-2">({groupTraces.length})</span>
                  </Typography>
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                </div>
                <div className="grid gap-3">
                  {groupTraces.map(trace => renderTraceCard(trace))}
                </div>
              </div>
            ))}
          </div>
        )}

        {groupedData.length === 0 && (
          <div className="h-40 flex flex-col items-center justify-center text-white/50 border border-dashed border-white/10 rounded-lg bg-white/[0.02]">
            <Terminal size={32} className="mb-3 opacity-20 animate-pulse" />
            <p className="text-[10px] tracking-[0.2em] font-bold">NO_TRACES_FOUND // FILTER_ACTIVE</p>
          </div>
        )}
      </div>
    </div>
  );
}
