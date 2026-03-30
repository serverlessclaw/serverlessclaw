import React from 'react';
import { Lock, Eye, FileWarning, Globe, Server, Database } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import SafetyTierEditor from '@/components/SafetyTierEditor';
import { THEME } from '@/lib/theme';

const AGENT_POLICIES = [
  {
    agent: 'SuperClaw',
    capabilities: ['Read/Write Memory', 'Dispatch Tasks', 'Trigger Deployments', 'Read Traces'],
    resources: ['MemoryTable', 'AgentBus', 'Deployer', 'TraceTable'],
    risk: 'Medium'
  },
  {
    agent: 'Coder Agent',
    capabilities: ['Write Code', 'Read Code', 'Pre-flight Validation'],
    resources: ['StagingBucket', 'Local Filesystem'],
    risk: 'High'
  },
  {
    agent: 'Strategic Planner',
    capabilities: ['Prioritize Capability Gaps', 'Draft Evolution Plans', 'Dispatch Evolution Tasks'],
    resources: ['ConfigTable', 'MemoryTable', 'AgentBus'],
    risk: 'Medium'
  },
  {
    agent: 'Cognition Reflector',
    capabilities: ['Distill Memory', 'Extract Tactical Lessons', 'Identify Capability Gaps'],
    resources: ['TraceTable', 'MemoryTable'],
    risk: 'Low'
  },
  {
    agent: 'QA Auditor',
    capabilities: ['Verify Task Completion', 'Analyze Execution Traces', 'Close Capability Gaps'],
    resources: ['TraceTable', 'MemoryTable', 'AgentBus'],
    risk: 'Low'
  },
  {
    agent: 'Build Monitor',
    capabilities: ['Read Build Logs', 'Emit Failure Events'],
    resources: ['CodeBuild Logs', 'AgentBus'],
    risk: 'Low'
  }
];

const PROTECTED_RESOURCES = [
  { path: 'sst.config.ts', type: 'Infra', protection: 'HARD_BLOCK', reason: 'Prevents resource deletion' },
  { path: 'src/tools/index.ts', type: 'Logic', protection: 'HARD_BLOCK', reason: 'Prevents tool hijacking' },
  { path: 'src/lib/agent.ts', type: 'Core', protection: 'HARD_BLOCK', reason: 'Prevents prompt injection in core' },
  { path: 'buildspec.yml', type: 'CI/CD', protection: 'HARD_BLOCK', reason: 'Prevents pipeline tampering' },
  { path: 'src/infra/**', type: 'Topology', protection: 'HARD_BLOCK', reason: 'Protects AWS definitions' },
  { path: 'infra/bootstrap/**', type: 'Bootstrap', protection: 'HARD_BLOCK', reason: 'Critical setup protection' }
];

export default function SecurityManifestPage() {
  return (
    <main className={`flex-1 overflow-y-auto p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-[${THEME.COLORS.PRIMARY}]/5 via-transparent to-transparent`}>
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <Typography variant="h2" weight="bold" color="white" glow>Security Manifest</Typography>
          <Typography variant="body" color="white" className="mt-2 block opacity-80">Governance boundaries and autonomous permission boundaries.</Typography>
        </div>
        <div className="flex gap-4">
          <Card variant="glass" padding="sm" className={`border-[${THEME.COLORS.PRIMARY}]/30`}>
            <Typography variant="mono" color="muted" className="mb-1 block">Compliance Mode</Typography>
            <Typography variant="mono" weight="bold" color="primary">Strict Enforcement</Typography>
          </Card>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Safety Tier */}
        <div className="lg:col-span-12">
          <section className="mb-8">
            <Typography variant="caption" weight="bold" className="tracking-[0.2em] flex items-center gap-2 mb-6">
              <Lock size={14} className={`text-[${THEME.COLORS.PRIMARY}]`} /> Safety Tier
            </Typography>
            <SafetyTierEditor currentTier="sandbox" onTierChange={() => {}} />
          </section>
        </div>

        {/* Left: Agent Capabilities */}
        <div className="lg:col-span-12 space-y-8">
          <section>
            <Typography variant="caption" weight="bold" className={`tracking-[0.2em] flex items-center gap-2 mb-6`}>
              <Globe size={14} className={`text-[${THEME.COLORS.PRIMARY}]`} /> Agent Capability Matrix
            </Typography>
            <div className="space-y-4">
              {AGENT_POLICIES.map((policy, i) => (
                <div key={i} className="glass-card p-6 border-white/5 bg-white/[0.01] hover:bg-white/[0.03] transition-all">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded bg-[${THEME.COLORS.PRIMARY}]/10 flex items-center justify-center text-[${THEME.COLORS.PRIMARY}]`}>
                        <Server size={16} />
                      </div>
                      <Typography variant="body" weight="bold">{policy.agent}</Typography>
                    </div>
                    <Badge variant={policy.risk === 'High' ? 'danger' : policy.risk === 'Medium' ? 'warning' : 'primary'}>
                      {policy.risk} Risk
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <div className="text-[10px] text-white/50 uppercase font-bold mb-2">Capabilities</div>
                      <ul className="space-y-1">
                        {policy.capabilities.map((cap, j) => (
                          <li key={j} className="text-xs text-white/100 flex items-center gap-2">
                            <Eye size={10} className={`text-${THEME.COLORS.PRIMARY}/40`} /> {cap}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[10px] text-white/50 uppercase font-bold mb-2">Linked Resources</div>
                      <div className="flex flex-wrap gap-2">
                        {policy.resources.map((res, j) => (
                          <span key={j} className="text-[9px] px-2 py-0.5 rounded bg-black/40 border border-white/10 text-white/100">
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
          <section className="glass-card p-6 border-white/10 bg-black/40">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/100 flex items-center gap-2 mb-6">
              <Lock size={14} className={`text-${THEME.COLORS.DANGER}`} /> Protected Resource Labeling
            </h3>
            <div className="space-y-3">
              {PROTECTED_RESOURCES.map((res, i) => (
                <div key={i} className={`flex flex-col p-3 rounded bg-${THEME.COLORS.DANGER}/[0.02] border border-${THEME.COLORS.DANGER}/10 group hover:border-${THEME.COLORS.DANGER}/30 transition-all`}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[11px] font-mono text-white/100">{res.path}</span>
                    <span className={`text-[9px] font-bold text-${THEME.COLORS.DANGER}`}>{res.protection}</span>
                  </div>
                  <div className="flex justify-between items-center text-[9px]">
                    <span className="text-white/90 italic">{res.reason}</span>
                    <span className="text-white/50 uppercase tracking-tighter px-1 rounded border border-white/5">{res.type}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 pt-6 border-t border-white/5">
                <div className={`p-4 rounded bg-${THEME.COLORS.DANGER}/10 border border-${THEME.COLORS.DANGER}/20 flex gap-3`}>
                    <FileWarning size={16} className={`text-${THEME.COLORS.DANGER} shrink-0`} />
                    <p className={`text-[10px] text-${THEME.COLORS.DANGER}/70 leading-relaxed italic`}>
                        Writing to these paths requires Human-in-the-Loop (HITL) approval via Telegram. The Coder Agent cannot bypass this block.
                    </p>
                </div>
            </div>
          </section>

          <section className="glass-card p-6 border-white/10 bg-black/40">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/100 flex items-center gap-2 mb-4">
              <Database size={14} className={`text-${THEME.COLORS.INTEL}`} /> Infrastructure Boundaries (IAM)
            </h3>
            <p className="text-xs text-white/100 leading-relaxed mb-4 font-light">
                Permissions are hardware-enforced at the AWS IAM level. Agents only have access to the specific resources linked in <code className={`text-${THEME.COLORS.INTEL} font-bold`}>sst.config.ts</code>.
            </p>
            <div className="flex flex-wrap gap-2">
                <span className={`text-[9px] px-2 py-1 rounded bg-${THEME.COLORS.INTEL}/10 border border-${THEME.COLORS.INTEL}/30 text-${THEME.COLORS.INTEL} font-bold`}>Principle of Least Privilege</span>
                <span className={`text-[9px] px-2 py-1 rounded bg-${THEME.COLORS.INTEL}/10 border border-${THEME.COLORS.INTEL}/30 text-${THEME.COLORS.INTEL} font-bold`}>Scoped Tokens</span>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
