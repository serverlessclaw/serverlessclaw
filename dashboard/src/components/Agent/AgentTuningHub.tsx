'use client';

import React, { useState } from 'react';
import { 
  AlertTriangle, 
  RefreshCw, 
  ArrowRight, 
  CheckCircle, 
  Zap,
  Target,
  FileCode,
  Copy
} from 'lucide-react';
import { toast } from 'sonner';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';

interface TuningSuggestions {
  rootCause: string;
  suggestions: string[];
  improvedPromptSnippet: string;
  confidence: number;
}

export default function AgentTuningHub({ 
  agentId, 
  lastTraceId,
  errorDistribution = {}
}: { 
  agentId: string;
  lastTraceId?: string;
  errorDistribution?: Record<string, number>;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestions, setSuggestions] = useState<TuningSuggestions | null>(null);

  const errorData = Object.entries(errorDistribution).map(([name, value]) => ({
    name: name.replace('ERROR#', ''),
    value
  })).sort((a, b) => b.value - a.value);

  const performAnalysis = async () => {
    if (!lastTraceId) {
      toast.error("No recent failures recorded for analysis.");
      return;
    }

    setAnalyzing(true);
    try {
      const res = await fetch('/api/agents/suggest-tuning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, traceId: lastTraceId })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSuggestions(data.suggestions);
      toast.success("Intelligence Hub: Tuning suggestions generated.");
    } catch (err) {
      console.error('Failed to generate suggestions:', err);
      toast.error("Failed to analyze failure markers.");
    } finally {
      setAnalyzing(false);
    }
  };

  const copySnippet = () => {
    if (suggestions?.improvedPromptSnippet) {
      navigator.clipboard.writeText(suggestions.improvedPromptSnippet);
      toast.success("Improvement snippet copied to clipboard.");
    }
  };

  return (
    <div className="space-y-8">
      {/* Error Distribution */}
      <Card variant="glass" className="overflow-hidden border-white/5">
        <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-500" />
            <Typography variant="mono" weight="bold" uppercase className="text-xs tracking-widest">Failure Markers</Typography>
          </div>
        </div>
        <div className="p-4 bg-black/40">
          {errorData.length > 0 ? (
             <div className="h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={errorData} layout="vertical" margin={{ left: -20 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" stroke="#ffffff40" fontSize={9} width={80} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#111', border: '1px solid #ffffff10', borderRadius: '4px', fontSize: '11px' }}
                      cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {errorData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index === 0 ? '#ef4444' : '#ef444480'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
             </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-white/20">
              <CheckCircle size={32} className="mb-2 opacity-10" />
              <Typography variant="caption" color="muted">No failure telemetry recorded.</Typography>
            </div>
          )}
        </div>
        {lastTraceId && (
          <Link href={`/trace/${lastTraceId}`} className="block p-3 border-t border-white/5 bg-red-500/[0.03] hover:bg-red-500/10 transition-colors">
            <div className="flex items-center justify-between">
              <Typography variant="mono" className="text-[10px] text-red-400 font-bold uppercase tracking-widest">Replay Last Failure</Typography>
              <ArrowRight size={12} className="text-red-400" />
            </div>
          </Link>
        )}
      </Card>

      {/* Tuning Action Card */}
      <Card variant="glass" className="p-6 border-cyber-blue/20 bg-cyber-blue/[0.02] space-y-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-cyber-blue/10 border border-cyber-blue/20 flex items-center justify-center flex-shrink-0">
             <Target size={20} className="text-cyber-blue" />
          </div>
          <div>
            <Typography variant="h3" weight="bold" color="white" className="mb-1">Evolution sandbox</Typography>
            <Typography variant="caption" color="muted" className="leading-relaxed block">
              Identify cognitive drift and generate prompt remediation based on real-world failure patterns.
            </Typography>
          </div>
        </div>

        {!suggestions ? (
          <Button 
            onClick={performAnalysis} 
            variant="primary" 
            loading={analyzing}
            className="w-full h-12 uppercase font-black tracking-[0.2em] shadow-[0_0_20px_rgba(0,243,255,0.2)]"
            icon={<RefreshCw size={16} className={analyzing ? 'animate-spin' : ''} />}
          >
            {analyzing ? "Synthesizing Patterns..." : "Detect Cognitive Drift"}
          </Button>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="p-4 bg-black/60 rounded border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="border-cyber-blue/40 text-cyber-blue text-[8px] uppercase tracking-widest">Analysis Result</Badge>
                <div className="flex items-center gap-1.5">
                   <div className="w-1.5 h-1.5 rounded-full bg-cyber-green animate-pulse" />
                   <Typography variant="mono" className="text-[9px] text-cyber-green font-bold">Confidence: {(suggestions.confidence * 100).toFixed(0)}%</Typography>
                </div>
              </div>
              
              <div className="space-y-4">
                <div>
                  <Typography variant="mono" className="text-[9px] text-white/40 uppercase block mb-1">Root Cause</Typography>
                  <Typography variant="caption" color="white" className="italic leading-relaxed">
                    &ldquo;{suggestions.rootCause}&rdquo;
                  </Typography>
                </div>

                <div>
                  <Typography variant="mono" className="text-[9px] text-white/40 uppercase block mb-2">Remediation Steps</Typography>
                  <ul className="space-y-2">
                    {suggestions.suggestions.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px] text-white/70 leading-relaxed font-mono">
                        <Zap size={10} className="text-yellow-400 mt-1 flex-shrink-0" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {suggestions.improvedPromptSnippet && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                   <Typography variant="mono" className="text-[9px] text-white/40 uppercase">Optimized Directive</Typography>
                   <button onClick={copySnippet} className="text-cyber-blue/60 hover:text-cyber-blue transition-colors">
                      <Copy size={12} />
                   </button>
                </div>
                <div className="p-3 bg-black/80 rounded border border-white/5 font-mono text-[10px] text-cyber-blue/80 max-h-[150px] overflow-y-auto">
                   {suggestions.improvedPromptSnippet}
                </div>
              </div>
            )}

            <div className="flex gap-3">
               <Button 
                onClick={() => setSuggestions(null)} 
                variant="outline" 
                size="sm"
                className="flex-1 text-[10px] uppercase font-bold"
               >
                 Dismiss
               </Button>
               <Button 
                variant="primary" 
                size="sm"
                className="flex-[2] text-[10px] uppercase font-bold"
                icon={<FileCode size={14} />}
                onClick={() => {
                  const params = new URLSearchParams();
                  params.set('agentId', agentId);
                  params.set('suggestedPrompt', suggestions.improvedPromptSnippet);
                  if (lastTraceId) params.set('replayTraceId', lastTraceId);
                  window.location.href = `/playground?${params.toString()}`;
                }}
               >
                 Apply Pattern
               </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
