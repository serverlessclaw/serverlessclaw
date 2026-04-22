'use client';

import React, { useState } from 'react';
import { Lock, Eye, FileWarning, Globe, Server } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import SafetyTierEditor from '@/components/SafetyTierEditor';
import CoManagementHub from '@/components/CoManagementHub';
import PageHeader from '@/components/PageHeader';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

const AGENT_POLICIES = [
  {
    agent: 'SuperClaw',
    capabilities: ['Read/Write Memory', 'Dispatch Tasks', 'Trigger Deployments', 'Read Traces'],
    resources: ['MemoryTable', 'AgentBus', 'Deployer', 'TraceTable'],
    risk: 'Medium',
  },
  {
    agent: 'Coder Agent',
    capabilities: ['Write Code', 'Read Code', 'Pre-flight Validation'],
    resources: ['StagingBucket', 'Local Filesystem'],
    risk: 'High',
  },
  {
    agent: 'Strategic Planner',
    capabilities: [
      'Prioritize Capability Gaps',
      'Draft Evolution Plans',
      'Dispatch Evolution Tasks',
    ],
    resources: ['ConfigTable', 'MemoryTable', 'AgentBus'],
    risk: 'Medium',
  },
  {
    agent: 'Cognition Reflector',
    capabilities: ['Distill Memory', 'Extract Tactical Lessons', 'Identify Capability Gaps'],
    resources: ['TraceTable', 'MemoryTable'],
    risk: 'Low',
  },
  {
    agent: 'QA Auditor',
    capabilities: ['Verify Task Completion', 'Analyze Execution Traces', 'Close Capability Gaps'],
    resources: ['TraceTable', 'MemoryTable', 'AgentBus'],
    risk: 'Low',
  },
  {
    agent: 'Build Monitor',
    capabilities: ['Read Build Logs', 'Emit Failure Events'],
    resources: ['CodeBuild Logs', 'AgentBus'],
    risk: 'Low',
  },
];

const PROTECTED_RESOURCES = [
  {
    path: 'sst.config.ts',
    type: 'Infra',
    protection: 'HARD_BLOCK',
    reason: 'Prevents resource deletion',
  },
  {
    path: 'src/tools/index.ts',
    type: 'Logic',
    protection: 'HARD_BLOCK',
    reason: 'Prevents tool hijacking',
  },
  {
    path: 'src/lib/agent.ts',
    type: 'Core',
    protection: 'HARD_BLOCK',
    reason: 'Prevents prompt injection in core',
  },
  {
    path: 'buildspec.yml',
    type: 'CI/CD',
    protection: 'HARD_BLOCK',
    reason: 'Prevents pipeline tampering',
  },
  {
    path: 'src/infra/**',
    type: 'Topology',
    protection: 'HARD_BLOCK',
    reason: 'Protects AWS definitions',
  },
  {
    path: 'infra/bootstrap/**',
    type: 'Bootstrap',
    protection: 'HARD_BLOCK',
    reason: 'Critical setup protection',
  },
];

export default function SecurityManifestPage() {
  const { t } = useTranslations();
  const [currentTier, setCurrentTier] = useState<'local' | 'prod'>('prod');
  return (
    <div
      className={`flex-1 space-y-10 bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--cyber-green)_5%,transparent),transparent,transparent)]`}
    >
      <PageHeader
        titleKey="SECURITY_TITLE"
        subtitleKey="SECURITY_SUBTITLE"
        stats={
          <div className="flex gap-4">
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                MODE
              </Typography>
              <Badge variant="primary" className="px-4 py-1 font-black text-xs">
                STRICT
              </Badge>
            </div>
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                POLICIES
              </Typography>
              <Badge variant="intel" className="px-4 py-1 font-black text-xs">
                {AGENT_POLICIES.length}
              </Badge>
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Safety Tier */}
        <div className="lg:col-span-12">
          <section className="mb-8">
            <Typography
              variant="caption"
              weight="bold"
              className="tracking-[0.2em] flex items-center gap-2 mb-6"
            >
              <Lock size={14} className="text-cyber-green" /> Safety Tier
            </Typography>
            <SafetyTierEditor
              currentTier={currentTier}
              onTierChange={(tier) => setCurrentTier(tier as 'local' | 'prod')}
            />
          </section>
        </div>

        {/* Co-Management Hub */}
        <div className="lg:col-span-12">
          <CoManagementHub />
        </div>

        {/* Left: Agent Capabilities */}
        <div className="lg:col-span-12 space-y-8">
          <section>
            <Typography
              variant="caption"
              weight="bold"
              className={`tracking-[0.2em] flex items-center gap-2 mb-6`}
            >
              <Globe size={14} className="text-cyber-green" /> Agent Capability Matrix
            </Typography>
            <div className="space-y-4">
              {AGENT_POLICIES.map((policy, i) => (
                <div
                  key={i}
                  className="glass-card p-6 border-border bg-card/10 hover:bg-card-elevated transition-all"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-cyber-green/10 flex items-center justify-center text-cyber-green">
                        <Server size={16} />
                      </div>
                      <Typography variant="body" weight="bold">
                        {policy.agent}
                      </Typography>
                    </div>
                    <Badge
                      variant={
                        policy.risk === 'High'
                          ? 'danger'
                          : policy.risk === 'Medium'
                            ? 'warning'
                            : 'primary'
                      }
                    >
                      {policy.risk} Risk
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase font-bold mb-2">
                        Capabilities
                      </div>
                      <ul className="space-y-1">
                        {policy.capabilities.map((cap, j) => (
                          <li key={j} className="text-xs text-foreground flex items-center gap-2">
                            <Eye size={10} className="text-primary/40" /> {cap}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase font-bold mb-2">
                        Linked Resources
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {policy.resources.map((res, j) => (
                          <span
                            key={j}
                            className="text-[9px] px-2 py-0.5 rounded bg-card border border-border text-foreground"
                          >
                            {res}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right: Protected Resources */}
        <div className="lg:col-span-5 space-y-8">
          <section className="glass-card p-6 border-border bg-card">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-foreground flex items-center gap-2 mb-6">
              <Lock size={14} className="text-red-500" /> Protected Resource Labeling
            </h3>
            <div className="space-y-3">
              {PROTECTED_RESOURCES.map((res, i) => (
                <div
                  key={i}
                  className="flex flex-col p-3 rounded bg-red-500/5 border border-red-500/10 group hover:border-red-500/30 transition-all"
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[11px] font-mono text-foreground">{res.path}</span>
                    <span className="text-[9px] font-bold text-red-500">{res.protection}</span>
                  </div>
                  <div className="flex justify-between items-center text-[9px]">
                    <span className="text-muted-foreground italic">{res.reason}</span>
                    <span className="text-muted-more uppercase tracking-tighter px-1 rounded border border-border">
                      {res.type}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 pt-6 border-t border-border">
              <div className="p-4 rounded bg-red-500/10 border border-red-500/20 flex gap-3">
                <FileWarning size={16} className="text-red-500 shrink-0" />
                <p className="text-[10px] text-red-500/70 leading-relaxed italic">
                  Writing to these paths requires Human-in-the-Loop (HITL) approval via Telegram.
                  The Coder Agent cannot bypass this block.
                </p>
              </div>
            </div>
          </section>

          <section className="glass-card p-6 border-border bg-card">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-foreground flex items-center gap-2 mb-4">
              <Lock size={14} className="text-cyber-blue" /> Infrastructure Boundaries (IAM)
            </h3>
            <p className="text-xs text-foreground leading-relaxed mb-4 font-light">
              Permissions are hardware-enforced at the AWS IAM level. Agents only have access to the
              specific resources linked in{' '}
              <code className="text-cyber-blue font-bold">sst.config.ts</code>.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="text-[9px] px-2 py-1 rounded bg-cyber-blue/10 border border-cyber-blue/30 text-cyber-blue font-bold">
                Principle of Least Privilege
              </span>
              <span className="text-[9px] px-2 py-1 rounded bg-cyber-blue/10 border border-cyber-blue/30 text-cyber-blue font-bold">
                Scoped Tokens
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
