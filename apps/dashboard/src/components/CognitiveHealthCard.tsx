'use client';

import React from 'react';
import Card from '@/components/ui/Card';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import { AlertTriangle } from 'lucide-react';
import { Anomaly } from '@/lib/types/dashboard';

interface CognitiveHealthCardProps {
  agentId: string;
  score: number;
  taskCompletionRate: number;
  reasoningCoherence: number;
  errorRate: number;
  memoryFragmentation: number;
  anomalies: Anomaly[];
}

function severityVariant(severity: string) {
  switch (severity) {
    case 'CRITICAL':
      return 'danger';
    case 'HIGH':
      return 'warning';
    case 'MEDIUM':
      return 'audit';
    default:
      return 'outline';
  }
}

function gaugeColor(score: number) {
  if (score >= 80)
    return {
      stroke: 'var(--cyber-green)',
      glow: 'color-mix(in srgb, var(--cyber-green) 30%, transparent)',
    };
  if (score >= 60)
    return { stroke: '#f59e0b', glow: 'color-mix(in srgb, #f59e0b 30%, transparent)' };
  return { stroke: '#ef4444', glow: 'color-mix(in srgb, #ef4444 30%, transparent)' };
}

export default function CognitiveHealthCard({
  agentId,
  score,
  taskCompletionRate,
  reasoningCoherence,
  errorRate,
  memoryFragmentation,
  anomalies,
}: CognitiveHealthCardProps) {
  const size = 100;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, score)) / 100) * circumference;
  const { stroke, glow } = gaugeColor(score);

  return (
    <Card variant="glass" padding="lg" className="border-border bg-card space-y-4">
      <div className="flex items-center justify-between">
        <Typography variant="caption" weight="bold" className="tracking-[0.15em] truncate">
          {agentId}
        </Typography>
        {anomalies.length > 0 && (
          <Badge variant="danger" className="flex items-center gap-1">
            <AlertTriangle size={10} /> {anomalies.length}
          </Badge>
        )}
      </div>

      <div className="flex justify-center relative">
        <svg width={size} height={size} className="transform -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-foreground/5"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dashoffset 1s ease-in-out',
              filter: `drop-shadow(0 0 4px ${glow})`,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold font-mono" style={{ color: stroke }}>
            {Math.round(Math.min(100, Math.max(0, score)))}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-[10px]">
          <span className="text-muted-foreground uppercase tracking-wider">Task Completion</span>
          <span className="font-mono text-foreground/90">
            {(taskCompletionRate * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-muted-foreground uppercase tracking-wider">
            Reasoning Coherence
          </span>
          <span className="font-mono text-foreground/90">{reasoningCoherence.toFixed(1)}/10</span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-muted-foreground uppercase tracking-wider">Error Rate</span>
          <span className="font-mono text-foreground/90">{(errorRate * 100).toFixed(1)}%</span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-muted-foreground uppercase tracking-wider">
            Memory Fragmentation
          </span>
          <span className="font-mono text-foreground/90">
            {(memoryFragmentation * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {anomalies.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border">
          <Typography
            variant="mono"
            color="muted"
            className="block uppercase tracking-widest text-[9px]"
          >
            Anomalies
          </Typography>
          {anomalies.map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <Badge
                variant={severityVariant(a.severity) as 'danger' | 'warning' | 'audit' | 'outline'}
                className="shrink-0 text-[8px]"
              >
                {a.severity}
              </Badge>
              <span className="text-[10px] text-muted-foreground leading-tight">{a.message}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
