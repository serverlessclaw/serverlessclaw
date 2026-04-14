import { ITool } from '../lib/types/tool';
import { logger } from '../lib/logger';

/**
 * Registry-less tool resolution logic.
 * This file avoids importing the heavy TOOLS object directly to keep context budget low,
 * or provides utilities for dynamic tool discovery.
 */

/**
 * Dynamically retrieves the tools assigned to a specific agent.
 *
 * @param agentId - The ID of the agent to fetch tools for.
 * @returns A promise that resolves to an array of ITool implementations.
 */
export async function getAgentTools(agentId: string): Promise<ITool[]> {
  const { AgentRegistry } = await import('../lib/registry');
  const { MCPMultiplexer } = await import('../lib/mcp');
  const { TOOLS } = await import('./index');

  logger.info(`[TOOLS] Resolving tools for: ${agentId}`);
  const config = await AgentRegistry.getAgentConfig(agentId);

  if (!config || !config.tools) {
    logger.warn(`No tools configured for agent ${agentId}, returning empty set.`);
    return [];
  }

  logger.info(`[TOOLS] Configured tools for ${agentId}: ${config.tools.join(', ')}`);

  // 1. Resolve local tools
  const localTools = config.tools
    .map((name: string) => (TOOLS as Record<string, ITool>)[name])
    .filter((t: ITool | undefined): t is ITool => !!t);

  logger.info(`[TOOLS] Local tools found: ${localTools.map((t) => t.name).join(', ')}`);

  // 2. Resolve external MCP tools if any match the requested tool names
  const externalTools = await MCPMultiplexer.getExternalTools(config.tools);

  // 3. Merge and deduplicate (Local tools take priority)
  const allToolsMap = new Map<string, ITool>();

  // Add external tools first
  for (const t of externalTools) {
    if (config.tools!.some((req) => t.name === req || t.name.startsWith(`${req}_`))) {
      allToolsMap.set(t.name, t);
    }
  }

  // Add local tools (overwriting external if name collision occurs)
  for (const t of localTools) {
    allToolsMap.set(t.name, t);
  }

  const finalTools = Array.from(allToolsMap.values());

  if (finalTools.length > localTools.length) {
    const externalAdded = finalTools.filter((ft) => !localTools.find((lt) => lt.name === ft.name));
    logger.info(`[TOOLS] External MCP tools added: ${externalAdded.map((t) => t.name).join(', ')}`);

    // Smart Warmup: Trigger background warmup for these servers if in a Lambda environment
    if (process.env.MCP_SERVER_ARNS) {
      try {
        const { WarmupManager } = await import('../lib/warmup');
        const serverArns = JSON.parse(process.env.MCP_SERVER_ARNS);
        const serversToWarm = Array.from(
          new Set(externalAdded.map((t) => t.name.split('_')[0]))
        ).filter((name) => serverArns[name]);

        if (serversToWarm.length > 0) {
          const warmupManager = new WarmupManager({
            servers: serverArns,
            agents: {},
            ttlSeconds: 900,
          });
          // Fire and forget
          warmupManager
            .smartWarmup({
              servers: serversToWarm,
              intent: `agent-needs-tools:${agentId}`,
              warmedBy: 'webhook', // Reusing webhook category for manual/agent triggers
            })
            .catch((err) => logger.warn('[TOOLS] Smart warmup background error:', err));
        }
      } catch (warmupErr) {
        logger.warn('[TOOLS] Failed to initiate smart warmup:', warmupErr);
      }
    }
  }

  return finalTools;
}

/**
 * Generates an array of tool definitions for use in LLM completion calls.
 *
 * @param tools - Record of tools to generate definitions for.
 * @returns Array of function definitions formatted for LLM tool selection.
 */
export function getToolDefinitions(tools: Record<string, ITool>) {
  return Object.values(tools).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
