import React from 'react';
import { ShieldCheck, Lock, Eye, FileWarning, Globe, Server, Database } from 'lucide-react';

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
    <main className="flex-1 overflow-y-auto p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-green/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight glow-text">SECURITY_MANIFEST</h2>
          <p className="text-white/100 text-sm mt-2 font-light">Governance boundaries and autonomous permission boundaries.</p>
        </div>
        <div className="flex gap-4">
          <div className="glass-card px-4 py-2 text-[12px] border-cyber-green/30">
            <div className="text-white/90 mb-1">COMPLIANCE_MODE</div>
            <div className="font-bold text-cyber-green">STRICT_ENFORCEMENT</div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Agent Capabilities */}
        <div className="lg:col-span-7 space-y-8">
          <section>
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/100 flex items-center gap-2 mb-6">
              <Globe size={14} className="text-cyber-green" /> Agent Capability Matrix
            </h3>
            <div className="space-y-4">
              {AGENT_POLICIES.map((policy, i) => (
                <div key={i} className="glass-card p-6 border-white/5 bg-white/[0.01] hover:bg-white/[0.03] transition-all">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-cyber-green/10 flex items-center justify-center text-cyber-green">
                        <Server size={16} />
                      </div>
                      <h4 className="font-bold text-white/90">{policy.agent}</h4>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                      policy.risk === 'High' ? 'border-red-500/30 text-red-400' : 
                      policy.risk === 'Medium' ? 'border-yellow-500/30 text-yellow-400' : 'border-cyber-green/30 text-cyber-green'
                    }`}>
                      {policy.risk}_RISK
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <div className="text-[10px] text-white/50 uppercase font-bold mb-2">Capabilities</div>
                      <ul className="space-y-1">
                        {policy.capabilities.map((cap, j) => (
                          <li key={j} className="text-xs text-white/100 flex items-center gap-2">
                            <Eye size={10} className="text-cyber-green/40" /> {cap}
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
          <section className="glass-card p-6 border-white/10 bg-black/40 sticky top-10">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/100 flex items-center gap-2 mb-6">
              <Lock size={14} className="text-red-500" /> Protected Resource Labeling
            </h3>
            <div className="space-y-3">
              {PROTECTED_RESOURCES.map((res, i) => (
                <div key={i} className="flex flex-col p-3 rounded bg-red-500/[0.02] border border-red-500/10 group hover:border-red-500/30 transition-all">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[11px] font-mono text-white/100">{res.path}</span>
                    <span className="text-[9px] font-bold text-red-500">{res.protection}</span>
                  </div>
                  <div className="flex justify-between items-center text-[9px]">
                    <span className="text-white/90 italic">{res.reason}</span>
                    <span className="text-white/50 uppercase tracking-tighter px-1 rounded border border-white/5">{res.type}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 pt-6 border-t border-white/5">
                <div className="p-4 rounded bg-red-500/10 border border-red-500/20 flex gap-3">
                    <FileWarning size={16} className="text-red-500 shrink-0" />
                    <p className="text-[10px] text-red-200/70 leading-relaxed italic">
                        Writing to these paths requires Human-in-the-Loop (HITL) approval via Telegram. The Coder Agent cannot bypass this block.
                    </p>
                </div>
            </div>
          </section>

          <section className="glass-card p-6 border-white/10 bg-black/40">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/100 flex items-center gap-2 mb-4">
              <Database size={14} className="text-cyber-blue" /> Infrastructure Boundaries (IAM)
            </h3>
            <p className="text-xs text-white/100 leading-relaxed mb-4 font-light">
                Permissions are hardware-enforced at the AWS IAM level. Agents only have access to the specific resources linked in <code className="text-cyber-blue font-bold">sst.config.ts</code>.
            </p>
            <div className="flex flex-wrap gap-2">
                <span className="text-[9px] px-2 py-1 rounded bg-cyber-blue/10 border border-cyber-blue/30 text-cyber-blue font-bold">Principle of Least Privilege</span>
                <span className="text-[9px] px-2 py-1 rounded bg-cyber-blue/10 border border-cyber-blue/30 text-cyber-blue font-bold">Scoped Tokens</span>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
