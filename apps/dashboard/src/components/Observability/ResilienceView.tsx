'use client';

import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, Activity, Zap } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

interface ResilienceMetrics {
  healthScore: number;
  errorRate: number;
  recoverySuccess: number;
  recoveryCount: number;
  circuitBreaker: {
    state: string;
    lastFailure: number | null;
    failureCount: number;
  };
}

export default function ResilienceView() {
  const [metrics, setMetrics] = useState<ResilienceMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/resilience/metrics')
      .then((res) => res.json())
      .then(setMetrics)
      .catch(() => setMetrics(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null; // Placeholder handled by parent

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Gauge Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <GaugeCard
          label="HEALTH_SCORE"
          value={metrics?.healthScore ?? 0}
          icon={Activity}
          color="text-cyber-green"
          suffix="%"
        />
        <GaugeCard
          label="RECOVERY_EFFICIENCY"
          value={metrics?.recoverySuccess ?? 0}
          icon={RefreshCw}
          color="text-cyber-blue"
          suffix="%"
        />
        <GaugeCard
          label="CIRC_BREAKER_INTEGRITY"
          value={metrics?.circuitBreaker.state === 'closed' ? 100 : 0}
          icon={ShieldAlert}
          color={metrics?.circuitBreaker.state === 'closed' ? 'text-cyber-green' : 'text-red-500'}
          suffix="%"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* State Card */}
        <Card variant="glass" padding="lg" className="border-border/40 bg-card/40">
          <div className="flex items-center justify-between mb-6">
            <Typography
              variant="caption"
              weight="black"
              className="tracking-widest flex items-center gap-2"
            >
              <Zap size={14} className="text-cyber-blue" /> Stability_Diagnostics
            </Typography>
            <Badge variant={metrics?.circuitBreaker.state === 'closed' ? 'primary' : 'danger'}>
              {metrics?.circuitBreaker.state?.toUpperCase() ?? 'UNKNOWN'}
            </Badge>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-border/20">
              <span className="text-[10px] text-muted-foreground uppercase font-mono">
                Rollback Availability
              </span>
              <span className="text-cyber-green font-mono text-xs">V-STABLE</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/20">
              <span className="text-[10px] text-muted-foreground uppercase font-mono">
                Failure Threshold
              </span>
              <span className="text-foreground font-mono text-xs">5 consecutive</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/20">
              <span className="text-[10px] text-muted-foreground uppercase font-mono">
                Current Chain Depth
              </span>
              <span className="text-foreground font-mono text-xs">
                {metrics?.recoveryCount ?? 0} OPS
              </span>
            </div>
          </div>
        </Card>

        {/* Advisory Card */}
        <Card variant="outline" padding="lg" className="border-cyber-blue/10 bg-cyber-blue/[0.02]">
          <Typography
            variant="caption"
            weight="bold"
            className="text-cyber-blue mb-3 flex items-center gap-2"
          >
            <ShieldAlert size={14} /> SYSTEM_ADVISORY
          </Typography>
          <Typography variant="body" italic className="text-xs leading-relaxed opacity-80 block">
            The Resilience Sector monitors the autonomous recovery sequence. If the Circuit Breaker
            is &quot;Open&quot;, all automated evolutionary deployments are halted until a human SME
            performs a consensus verification. Error rates exceeding 15% will trigger a diagnostic
            trace.
          </Typography>
        </Card>
      </div>
    </div>
  );
}

function GaugeCard({
  label,
  value,
  icon: Icon,
  color,
  suffix,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  suffix?: string;
}) {
  return (
    <Card variant="glass" padding="lg" className="border-border/40 relative overflow-hidden group">
      <div className="flex flex-col items-center text-center">
        <Typography
          variant="mono"
          color="muted"
          className="text-[10px] uppercase tracking-[0.2em] mb-4"
        >
          {label}
        </Typography>
        <div className={`text-4xl font-black ${color} mb-2 tracking-tighter tabular-nums`}>
          {value}
          {suffix}
        </div>
        <Icon
          size={16}
          className={`${color} opacity-40 group-hover:scale-110 transition-transform`}
        />
      </div>
    </Card>
  );
}
