import React, { useState, useEffect } from 'react';
import Card from './ui/Card';
import Typography from './ui/Typography';
import Button from './ui/Button';
import Badge from './ui/Badge';
import { Shield, Zap, TrendingUp, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import TrustGauge from './TrustGauge';

interface Proposal {
  id: string;
  agentId: string;
  targetMode: 'AUTO' | 'HITL';
  reason: string;
  trustScore: number;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected';
}

export default function CoManagementHub() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);

  // Mock data for initial UI development
  useEffect(() => {
    const timer = setTimeout(() => {
      setProposals([
        {
          id: 'prop_1',
          agentId: 'coder',
          targetMode: 'AUTO',
          reason: 'Consistently passing all pre-flight security checks for 50+ iterations.',
          trustScore: 92,
          createdAt: Date.now() - 3600000,
          status: 'pending',
        },
      ]);
      setLoading(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleAction = (id: string, action: 'approve' | 'reject') => {
    setProposals((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: action === 'approve' ? 'approved' : 'rejected' } : p
      )
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <Typography
          variant="caption"
          weight="bold"
          className="tracking-[0.2em] flex items-center gap-2"
        >
          <Shield size={14} className="text-[var(--cyber-green)]" /> Co-Management Hub
        </Typography>
        <Badge variant="primary" className="animate-pulse">
          Active Trust Negotiation
        </Badge>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card variant="glass" className="flex flex-col items-center justify-center p-8 bg-card/10">
          <TrustGauge score={94} label="System Trust" size={140} />
          <div className="mt-4 text-center">
            <Typography variant="caption" color="muted">
              COGNITIVE HEALTH:{' '}
            </Typography>
            <Typography variant="mono" color="primary" weight="bold" className="text-[10px]">
              OPTIMAL
            </Typography>
          </div>
        </Card>

        <Card variant="glass" className="md:col-span-2 p-6 bg-card/5">
          <div className="flex items-center gap-2 mb-6">
            <Zap size={16} className="text-yellow-400" />
            <Typography variant="body" weight="bold">
              Active Autonomy Proposals
            </Typography>
          </div>

          <div className="space-y-4">
            {loading ? (
              <div className="animate-pulse space-y-3">
                <div className="h-20 bg-muted-more/10 rounded-lg" />
              </div>
            ) : proposals.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-border rounded-lg">
                <Typography variant="caption" color="muted">
                  No pending proposals
                </Typography>
              </div>
            ) : (
              proposals.map((proposal) => (
                <div
                  key={proposal.id}
                  className="relative group overflow-hidden rounded-xl border border-border bg-card p-5 hover:border-cyber-green/30 transition-all"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
                        <TrendingUp size={20} className="text-primary" />
                      </div>
                      <div>
                        <Typography variant="body" weight="bold" color="white">
                          Shift {proposal.agentId.toUpperCase()} to {proposal.targetMode}
                        </Typography>
                        <Typography variant="mono" color="muted" className="opacity-60 text-[10px]">
                          ID: {proposal.id} • {new Date(proposal.createdAt).toLocaleTimeString()}
                        </Typography>
                      </div>
                    </div>
                    {proposal.status !== 'pending' ? (
                      <Badge variant={proposal.status === 'approved' ? 'primary' : 'danger'}>
                        {proposal.status.toUpperCase()}
                      </Badge>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-1.5 rounded-full bg-cyber-green animate-ping" />
                        <Typography
                          variant="mono"
                          color="primary"
                          weight="bold"
                          className="text-[10px]"
                        >
                          HIGH TRUST
                        </Typography>
                      </div>
                    )}
                  </div>

                  <Typography
                    variant="caption"
                    className="text-muted-foreground italic mb-4 border-l-2 border-[var(--cyber-green)]/30 pl-3"
                  >
                    &quot;{proposal.reason}&quot;
                  </Typography>

                  {proposal.status === 'pending' && (
                    <div className="flex gap-3 justify-end mt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/20"
                        onClick={() => handleAction(proposal.id, 'reject')}
                      >
                        <XCircle size={14} className="mr-2" /> Reject
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleAction(proposal.id, 'approve')}
                      >
                        <CheckCircle2 size={14} className="mr-2" /> Approve Autonomy
                      </Button>
                    </div>
                  )}

                  <div className="absolute top-0 right-0 p-2 opacity-5 translate-x-2 -translate-y-2">
                    <AlertCircle size={80} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card variant="glass" className="p-6 border-cyber-blue/10 bg-cyber-blue/[0.02]">
        <div className="flex gap-4">
          <div className="w-10 h-10 rounded-full bg-cyber-blue/20 flex items-center justify-center shrink-0">
            <AlertCircle size={20} className="text-cyber-blue" />
          </div>
          <div>
            <Typography variant="body" weight="bold" color="intel">
              Governance Policy Notice
            </Typography>
            <Typography variant="caption" color="muted" className="mt-1 leading-relaxed">
              Moving an agent to <strong>AUTO</strong> mode allows it to execute Class A and B
              actions without human intervention. Class C (Critical Infrastructure) actions still
              require explicit governance class overrides even in AUTO mode.
            </Typography>
          </div>
        </div>
      </Card>
    </div>
  );
}
