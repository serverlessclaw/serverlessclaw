export const dynamic = 'force-dynamic';
import { AlertCircle } from 'lucide-react';
import { tools } from '@/lib/tool-definitions';
import CapabilitiesView from '@/components/CapabilitiesView';

async function getAgentConfigs() {
  try {
    const { AgentRegistry } = await import('@claw/core/lib/registry');
    const configs = await AgentRegistry.getAllConfigs();
    
    return Object.entries(configs).map(([id, config]) => ({
      id,
      name: config.name || id,
      description: config.description || '',
      tools: config.tools || [],
      icon: config.icon
    }));
  } catch (e) {
    console.error('Error fetching agent configs:', e);
    return [];
  }
}

export default async function CapabilitiesPage() {
  const agents = await getAgentConfigs();
  const allTools = Object.values(tools).map(t => ({
    name: t.name,
    description: t.description
  }));

  return (
    <main className="flex-1 overflow-y-auto p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-yellow-500/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <h2 className="text-3xl font-black tracking-tighter glow-text-yellow">CAPABILITIES_ROSTER</h2>
          <p className="text-white/40 text-[10px] mt-2 font-bold uppercase tracking-[0.3em]">Management of neural toolsets and autonomous permissions.</p>
        </div>
      </header>

      <CapabilitiesView agents={agents} allTools={allTools} />

      <div className="glass-card p-6 border-white/5 text-white/40 flex items-center gap-4">
        <AlertCircle size={20} className="text-yellow-500/60 shrink-0" />
        <p className="text-[10px] uppercase tracking-widest leading-relaxed">
          [SYSTEM_ADVISORY]: Toggling tools takes effect immediately on the next agent turn. Removing core tools like 
          <span className="text-yellow-500 mx-1 font-bold">dispatchTask</span> from the Main agent or 
          <span className="text-yellow-500 mx-1 font-bold">fileWrite</span> from the Coder may cause severe system degradation.
        </p>
      </div>
    </main>
  );
}
