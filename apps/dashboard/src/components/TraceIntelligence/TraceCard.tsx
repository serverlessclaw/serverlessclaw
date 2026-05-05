'use client';

import React from 'react';
import Link from 'next/link';
import { Clock, ChevronRight, Zap } from 'lucide-react';
import DeleteTraceButton from '@/components/DeleteTraceButton';
import { Trace } from '@/lib/types/ui';

import { EnrichedTrace } from './types';

interface TraceCardProps {
  trace: EnrichedTrace;
}

export default function TraceCard({ trace }: TraceCardProps) {
  return (
    <div className="relative group">
      <Link
        href={`/trace/${trace.traceId}?t=${trace.timestamp}`}
        className="glass-card p-4 hover:bg-foreground/[0.05] transition-all cursor-pointer block cyber-border relative overflow-hidden"
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
            <div className="text-sm font-medium text-foreground/90 truncate max-w-[200px] md:max-w-md">
              {trace.initialContext?.userText ?? 'System Task'}
            </div>
          </div>
          <div className="flex items-center justify-between md:justify-end gap-3 md:gap-6 text-[11px] text-foreground/90 pr-14">
            {(trace.totalTokens ?? 0) > 0 && (
              <div className="flex items-center gap-1.5 text-cyber-green/70 font-mono">
                <Zap size={12} /> {trace.totalTokens}{' '}
                <span className="text-[9px] opacity-50 uppercase">TKN</span>
              </div>
            )}
            <div className="flex items-center gap-2 font-mono opacity-60">
              <Clock size={12} /> {new Date(trace.timestamp).toISOString().slice(11, 19)}
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
                className="text-[8px] px-1.5 py-0.5 rounded bg-foreground/5 border border-border text-muted-foreground uppercase tracking-tighter"
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
}
