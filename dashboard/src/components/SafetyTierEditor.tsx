'use client';

import React from 'react';
import Card from '@/components/ui/Card';
import Typography from '@/components/ui/Typography';
import { ShieldCheck, ShieldAlert, Check, X } from 'lucide-react';

interface SafetyTierEditorProps {
  currentTier: 'sandbox' | 'autonomous';
  onTierChange: (tier: string) => void;
}

const TIERS = [
  {
    id: 'sandbox',
    label: 'Sandbox',
    description: 'Isolated execution environment with strict boundaries.',
    color: 'cyan',
    allows: [
      'Read-only file access',
      'Query database operations',
      'LLM reasoning & planning',
      'MCP tool read operations',
    ],
    blocks: [
      'Code modifications',
      'Production deployments',
      'Shell command execution',
      'MCP write operations',
      'Destructive file operations',
    ],
  },
  {
    id: 'autonomous',
    label: 'Autonomous',
    description: 'Full operational authority with guardrails and audit trail.',
    color: 'green',
    allows: [
      'Code modifications & PRs',
      'Staging deployments',
      'Shell command execution',
      'MCP full access',
      'File create/modify/delete',
      'Database read/write',
    ],
    blocks: ['Production deployments (requires approval)', 'Cross-account resource access'],
  },
];

export default function SafetyTierEditor({ currentTier, onTierChange }: SafetyTierEditorProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {TIERS.map((tier) => {
        const isActive = currentTier === tier.id;
        return (
          <Card
            key={tier.id}
            variant={isActive ? 'glass' : 'outline'}
            padding="lg"
            className={`border-2 transition-all cursor-pointer ${
              isActive
                ? 'border-cyber-blue/40 shadow-[0_0_20px_color-mix(in_srgb,var(--cyber-blue)_8%,transparent)]'
                : 'border-border hover:border-foreground/10'
            }`}
            onClick={() => onTierChange(tier.id)}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`w-10 h-10 rounded flex items-center justify-center ${
                  isActive
                    ? 'bg-cyber-blue/10 text-cyber-blue'
                    : 'bg-foreground/5 text-muted-foreground/50'
                }`}
              >
                {isActive ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
              </div>
              <div>
                <Typography
                  variant="caption"
                  weight="bold"
                  className={`tracking-[0.15em] ${isActive ? 'text-cyber-blue' : 'text-foreground/70'}`}
                >
                  {tier.label}
                </Typography>
                <Typography variant="body" color="muted" className="text-[10px] block mt-0.5">
                  {tier.description}
                </Typography>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Typography
                  variant="mono"
                  color="muted"
                  className="block uppercase tracking-widest text-[9px] mb-2"
                >
                  Allows
                </Typography>
                {tier.allows.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 py-0.5">
                    <Check size={10} className="text-cyber-green shrink-0" />
                    <span className="text-[10px] text-foreground/60">{item}</span>
                  </div>
                ))}
              </div>
              <div>
                <Typography
                  variant="mono"
                  color="muted"
                  className="block uppercase tracking-widest text-[9px] mb-2"
                >
                  Blocks
                </Typography>
                {tier.blocks.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 py-0.5">
                    <X size={10} className="text-red-400 shrink-0" />
                    <span className="text-[10px] text-foreground/60">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {isActive && (
              <div className="mt-4 pt-3 border-t border-cyber-blue/10">
                <Typography
                  variant="mono"
                  className="text-cyber-blue text-[9px] tracking-widest uppercase"
                >
                  Active Tier
                </Typography>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
