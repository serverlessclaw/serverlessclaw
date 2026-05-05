'use client';

import React, { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight, Terminal } from 'lucide-react';
import Link from 'next/link';
import Typography from '@/components/ui/Typography';
import { TRACE_TYPES } from '@claw/core/lib/constants';
import {
  Trace,
  TraceStep,
  ToolCallContent,
  LlmCallContent,
  LlmResponseContent,
} from '@/lib/types/ui';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

import StatsBar from './TraceIntelligence/StatsBar';
import FilterBar from './TraceIntelligence/FilterBar';
import TraceCard from './TraceIntelligence/TraceCard';
import GroupedTableView from './TraceIntelligence/GroupedTableView';
import { TabType, EnrichedTrace } from './TraceIntelligence/types';

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

export default function TraceIntelligenceView({
  initialTraces,
  sessionTitles,
  initialTab: initialTabProp,
  nextToken,
}: TraceIntelligenceViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslations();

  const [activeTab, setActiveTab] = useState<TabType>(initialTabProp || 'timeline');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'started' | 'error'>(
    'all'
  );
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [mountTime, setMountTime] = useState<number>(0);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setExpandedGroup(null);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMountTime(Date.now());
  }, []);

  const traces = useMemo<EnrichedTrace[]>(() => {
    return initialTraces.map((trace) => {
      const toolsUsed = trace.steps
        ? Array.from(
            new Set(
              trace.steps
                .filter((s: TraceStep) => s.type === TRACE_TYPES.TOOL_CALL)
                .map((s: TraceStep) => {
                  const content = s.content as ToolCallContent;
                  return content.toolName || content.tool || '';
                })
            )
          )
        : [];

      const llmCallStep = trace.steps?.find((s: TraceStep) => s.type === TRACE_TYPES.LLM_CALL);
      const llmResponseStep = trace.steps?.find(
        (s: TraceStep) => s.type === TRACE_TYPES.LLM_RESPONSE
      );

      const model =
        trace.initialContext?.model ||
        (llmCallStep?.content as LlmCallContent)?.model ||
        (llmResponseStep?.content as LlmResponseContent)?.model ||
        (typeof llmCallStep?.metadata?.model === 'string' ? llmCallStep.metadata.model : '') ||
        (typeof llmResponseStep?.metadata?.model === 'string'
          ? llmResponseStep.metadata.model
          : '') ||
        'UNKNOWN_MODEL';

      let totalTokens = 0;
      trace.steps?.forEach((s: TraceStep) => {
        if (s.type === TRACE_TYPES.LLM_RESPONSE && (s.content as LlmResponseContent).usage) {
          const usage = (s.content as LlmResponseContent).usage!;
          totalTokens +=
            usage.total_tokens || (usage.totalInputTokens ?? 0) + (usage.totalOutputTokens ?? 0);
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

  const filteredTraces = useMemo(() => {
    return traces.filter((trace) => {
      const text = trace.initialContext?.userText || '';
      const matchesSearch =
        trace.traceId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        trace.toolsUsed.some((tool: string) =>
          tool.toLowerCase().includes(searchQuery.toLowerCase())
        );

      const matchesStatus = statusFilter === 'all' || trace.status === statusFilter;
      const matchesSource = sourceFilter === 'all' || trace.source === sourceFilter;

      return matchesSearch && matchesStatus && matchesSource;
    });
  }, [traces, searchQuery, statusFilter, sourceFilter]);

  const groupedData = useMemo(() => {
    if (activeTab === 'timeline' || activeTab === 'live') return filteredTraces;

    const groups: Record<string, typeof traces> = {};
    filteredTraces.forEach((t) => {
      let key = 'UNKNOWN';
      if (activeTab === 'agents') key = t.agentId;
      else if (activeTab === 'sessions') {
        key = sessionTitles?.[t.sessionId]
          ? `${sessionTitles[t.sessionId]} (${t.sessionId.substring(0, 8)}...)`
          : t.sessionId;
      } else if (activeTab === 'models') key = t.model;
      else if (activeTab === 'tools') {
        t.toolsUsed.forEach((tool: string) => {
          if (!groups[tool]) groups[tool] = [];
          groups[tool].push(t);
        });
        return;
      }

      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filteredTraces, activeTab, sessionTitles]);

  const dateFilter = useMemo(() => {
    const startTimeParam = searchParams.get('startTime');
    if (!startTimeParam) return '24h';
    const startTimeNum = parseInt(startTimeParam);
    const now = mountTime || 0;
    if (now === 0) return 'all'; // Default while loading mount time
    const diffHours = (now - startTimeNum) / (1000 * 60 * 60);

    if (diffHours <= 25 && diffHours >= 23) return '24h';
    if (diffHours <= 169 && diffHours >= 167) return '7d';
    if (startTimeNum === 0) return 'all';
    return 'custom';
  }, [searchParams, mountTime]);

  const handleDateFilterChange = (value: 'all' | '24h' | '7d') => {
    const params = new URLSearchParams(searchParams.toString());
    const now = Date.now();
    if (value === '24h') params.set('startTime', (now - 24 * 60 * 60 * 1000).toString());
    else if (value === '7d') params.set('startTime', (now - 7 * 24 * 60 * 60 * 1000).toString());
    else if (value === 'all') params.set('startTime', '0');
    params.delete('nextToken');
    router.push(`/trace?${params.toString()}`);
  };

  return (
    <div className="space-y-8">
      <StatsBar traces={traces} t={t} />

      <FilterBar
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        sourceFilter={sourceFilter}
        setSourceFilter={setSourceFilter}
        dateFilter={dateFilter}
        setDateFilter={handleDateFilterChange}
        t={t}
      />

      <div className="space-y-6">
        {activeTab === 'live' ? (
          <div className="glass-card border-border overflow-hidden flex flex-col h-[600px]">
            <CollaborationCanvas />
          </div>
        ) : activeTab === 'timeline' ? (
          <div className="grid gap-3">
            {(groupedData as typeof traces).map((trace) => (
              <TraceCard key={trace.traceId} trace={trace} />
            ))}
          </div>
        ) : expandedGroup ? (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setExpandedGroup(null)}
                className="p-2 rounded-full hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors border border-border"
              >
                <ChevronRight size={18} className="rotate-180" />
              </button>
              <Typography
                variant="mono"
                color="primary"
                className="text-xs font-black tracking-widest uppercase"
              >
                {expandedGroup}
              </Typography>
            </div>
            <div className="grid gap-3">
              {(groupedData as Array<[string, typeof traces]>)
                .find(([name]) => name === expandedGroup)?.[1]
                .map((trace) => (
                  <TraceCard key={trace.traceId} trace={trace} />
                ))}
            </div>
          </div>
        ) : (
          <GroupedTableView
            groupedData={groupedData as Array<[string, typeof traces]>}
            t={t}
            onExpand={setExpandedGroup}
          />
        )}

        {nextToken && activeTab === 'timeline' && (
          <div className="flex justify-center pt-4">
            <Link
              href={`/trace?${(() => {
                const p = new URLSearchParams(searchParams.toString());
                p.set('nextToken', nextToken);
                return p.toString();
              })()}`}
              className="px-6 py-2 rounded bg-cyber-blue/10 border border-cyber-blue/30 text-cyber-blue text-xs font-bold uppercase tracking-widest hover:bg-cyber-blue/20 transition-colors"
            >
              Load More Traces
            </Link>
          </div>
        )}

        {activeTab !== 'live' && groupedData.length === 0 && (
          <div className="h-40 flex flex-col items-center justify-center text-muted-foreground border border-dashed border-border rounded-lg bg-foreground/[0.02]">
            <Terminal size={32} className="mb-3 opacity-20 animate-pulse" />
            <p className="text-[10px] tracking-[0.2em] font-bold">{t('NO_TRACES_FOUND')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
