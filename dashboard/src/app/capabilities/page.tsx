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

async function getMCPServers() {
  try {
    const { AgentRegistry } = await import('@claw/core/lib/registry');
    return (await AgentRegistry.getRawConfig('mcp_servers')) as Record<string, any> || {};
  } catch (e) {
    console.error('Error fetching MCP servers:', e);
    return {};
  }
}

async function getAllTools(usage: Record<string, { count: number; lastUsed: number }>) {
  try {
    const { MCPBridge } = await import('@claw/core/lib/mcp');
    
    // 1. Local tools
    const localTools = Object.values(tools).map(t => ({
      name: t.name,
      description: t.description,
      usage: usage[t.name] || { count: 0, lastUsed: 0 },
      isExternal: false
    }));

    // 2. MCP tools
    const externalTools = await MCPBridge.getAllExternalTools();
    const mcpTools = externalTools.map(t => ({
      name: t.name,
      description: t.description,
      usage: usage[t.name] || { count: 0, lastUsed: 0 },
      isExternal: true
    }));

    return [...localTools, ...mcpTools];
  } catch (e) {
    console.error('Error fetching all tools:', e);
    return Object.values(tools).map(t => ({
      name: t.name,
      description: t.description,
      usage: usage[t.name] || { count: 0, lastUsed: 0 },
      isExternal: false
    }));
  }
}

async function getToolUsage() {
  try {
    const { AgentRegistry } = await import('@claw/core/lib/registry');
    return (await AgentRegistry.getRawConfig('tool_usage')) as Record<string, { count: number; lastUsed: number }> || {};
  } catch (e) {
    console.error('Error fetching tool usage:', e);
    return {};
  }
}

export default async function CapabilitiesPage() {
  const agents = await getAgentConfigs();
  const usage = await getToolUsage();
  const mcpServers = await getMCPServers();
  const allTools = await getAllTools(usage);

  return (
    <main className="flex-1 overflow-y-auto p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-yellow-500/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <h2 className="text-3xl font-black tracking-tighter glow-text-yellow">CAPABILITIES_ROSTER</h2>
          <p className="text-white/40 text-[10px] mt-2 font-bold uppercase tracking-[0.3em]">Management of neural toolsets and autonomous permissions.</p>
        </div>
      </header>

      <CapabilitiesView 
        agents={agents} 
        allTools={allTools} 
        mcpServers={mcpServers}
      />

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
