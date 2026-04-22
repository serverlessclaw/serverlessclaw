'use client';

import React from 'react';
import Card from '@/components/ui/Card';
import Typography from '@/components/ui/Typography';
import { ShieldCheck, ShieldAlert, Check, X } from 'lucide-react';

interface SafetyTierEditorProps {
  currentTier: 'local' | 'prod';
  onTierChange: (tier: string) => void;
}

const TIERS = [
  {
    id: 'local',
    label: 'Local',
    description: 'Local development environment, full access for testing.',
    color: 'intel',
    allows: [
      'Code modifications & PRs',
      'Local deployments',
      'Shell command execution',
      'MCP full access',
      'File operations',
      'Database read/write',
    ],
    blocks: [],
  },
  {
    id: 'prod',
    label: 'Production',
    description: 'Production environment, strict safety and approval gates.',
    color: 'primary',
    allows: [
      'Code modifications & PRs',
      'LLM reasoning & planning',
      'MCP read operations',
      'Database read access',
    ],
    blocks: ['Direct deployments (requires approval)', 'Destructive database operations'],
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
            data-testid="card"
            className={`
              relative cursor-pointer transition-all duration-200
              ${
                isActive
                  ? 'border-cyber-blue/40 shadow-[0_0_20px_color-mix(in_srgb,var(--cyber-blue)_8%,transparent)]'
                  : 'border-border hover:border-foreground/10'
              }
            `}
            onClick={() => onTierChange(tier.id)}
          >
            {isActive && (
              <div className="absolute top-3 right-3">
                <ShieldCheck className="w-5 h-5 text-cyber-blue" data-testid="shield-check" />
              </div>
            )}
            {!isActive && (
              <div className="absolute top-3 right-3">
                <ShieldAlert className="w-5 h-5 text-muted-foreground" data-testid="shield-alert" />
              </div>
            )}

            <div className="mb-4">
              <Typography
                variant="h3"
                color={tier.id === 'local' ? 'intel' : 'primary'}
                className="font-semibold mb-2"
              >
                {tier.label}
              </Typography>
              <Typography variant="caption" className="text-muted-foreground">
                {tier.description}
              </Typography>
            </div>

            {isActive && (
              <div className="text-xs text-cyber-blue mb-3 font-medium">Active Tier</div>
            )}

            <div className="space-y-2">
              <Typography variant="caption" className="font-medium text-foreground">
                Allows:
              </Typography>
              <ul className="space-y-1">
                {tier.allows.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs">
                    <Check
                      className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0"
                      data-testid="check-icon"
                    />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>

              {tier.blocks.length > 0 && (
                <>
                  <Typography variant="caption" className="font-medium text-foreground mt-3">
                    Blocks:
                  </Typography>
                  <ul className="space-y-1">
                    {tier.blocks.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-xs">
                        <X
                          className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0"
                          data-testid="x-icon"
                        />
                        <span className="text-muted-foreground">{item}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
