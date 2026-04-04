export const dynamic = 'force-dynamic';
import { AlertCircle } from 'lucide-react';
import CapabilitiesView from '@/components/Capabilities/CapabilitiesView';
import Typography from '@/components/ui/Typography';
import Badge from '@/components/ui/Badge';
import { getToolUsage, getAllTools } from '@/lib/tool-utils';

async function getMCPServers() {
  try {
    const { AgentRegistry } = await import('@claw/core/lib/registry');
    const mcpServers: Record<string, string | { command: string; env?: Record<string, string> }> =
      ((await AgentRegistry.getRawConfig('mcp_servers')) as Record<
        string,
        string | { command: string; env?: Record<string, string> }
      > | null) ?? {};
    return mcpServers;
  } catch (e) {
    console.error('Error fetching MCP servers:', e);
    return {};
  }
}

// getToolUsage & getAllTools moved to dashboard/src/lib/tool-utils.ts

async function getAgentConfigs() {
  try {
    const { AgentRegistry } = await import('@claw/core/lib/registry');
    const configs = await AgentRegistry.getAllConfigs();
    const agents = Object.values(configs).map((c) => ({
      id: c.id,
      name: c.name,
      tools: c.tools ?? [],
    }));

    // Fetch individual usage for each agent
    const agentsWithUsage = await Promise.all(
      agents.map(async (a) => {
        const usage =
          ((await AgentRegistry.getRawConfig(`tool_usage_${a.id}`)) as Record<
            string,
            { count: number; lastUsed: number }
          >) ?? {};
        return { ...a, usage };
      })
    );

    return agentsWithUsage;
  } catch (e) {
    console.error('Error fetching agent configs:', e);
    return [];
  }
}

export default async function CapabilitiesPage() {
  const [usage, mcpServers, agents] = await Promise.all([
    getToolUsage(),
    getMCPServers(),
    getAgentConfigs(),
  ]);
  const allTools = await getAllTools(usage);

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <Typography variant="h2" color="white" glow uppercase>
            Tools & Skills
          </Typography>
          <Typography variant="body" color="muted" className="mt-2 block">
            Neural Skill Discovery & External Bridge Management.
          </Typography>
        </div>
        <div className="flex gap-4">
          <div className="flex flex-col items-center text-center">
            <Typography
              variant="mono"
              color="muted"
              className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
            >
              LOCAL
            </Typography>
            <Badge
              variant="outline"
              className="px-4 py-1 font-bold text-xs border-yellow-500/20 text-yellow-500/60 uppercase"
            >
              {allTools.filter((t) => !t.isExternal).length}
            </Badge>
          </div>
          <div className="flex flex-col items-center text-center">
            <Typography
              variant="mono"
              color="muted"
              className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
            >
              BRIDGES
            </Typography>
            <Badge
              variant="outline"
              className="px-4 py-1 font-bold text-xs border-cyber-blue/20 text-cyber-blue/60 uppercase"
            >
              {Object.keys(mcpServers).length}
            </Badge>
          </div>
        </div>
      </header>

      <CapabilitiesView allTools={allTools} mcpServers={mcpServers} agents={agents} />

      <div className="glass-card p-6 border-white/5 text-white/40 flex items-center gap-4">
        <AlertCircle size={20} className="text-[var(--cyber-blue)]/60 shrink-0" />
        <p className="text-[10px] uppercase tracking-widest leading-relaxed">
          [SYSTEM_ADVISORY]: This registry defines the global functional baseline. To assign these
          tools to specific agents, navigate to the{' '}
          <span className="text-[var(--cyber-blue)] mx-1 font-bold">Agents</span> page and select
          &quot;Configure Tools&quot; for the desired entity.
        </p>
      </div>
    </main>
  );
}
