export const dynamic = 'force-dynamic';
import { logger } from '@claw/core/lib/logger';
import CapabilitiesView from '@/components/Capabilities/CapabilitiesView';
import CapabilitiesHeader from './CapabilitiesHeader';
import CapabilitiesAdvisory from './CapabilitiesAdvisory';
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
    logger.error('Error fetching MCP servers:', e);
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
    logger.error('Error fetching agent configs:', e);
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

  const localCount = allTools.filter((t) => !t.isExternal).length;
  const bridgeCount = Object.keys(mcpServers).length;

   return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
      <CapabilitiesHeader localCount={localCount} bridgeCount={bridgeCount} />

      <CapabilitiesView allTools={allTools} mcpServers={mcpServers} agents={agents} />

      <CapabilitiesAdvisory />
    </main>
  );
}
