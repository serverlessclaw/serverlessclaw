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
  const { MCPBridge } = await import('../lib/mcp');
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
  const externalTools = await MCPBridge.getExternalTools(config.tools);
  const matchedExternal = externalTools.filter((t) => config.tools!.includes(t.name));

  if (matchedExternal.length > 0) {
    logger.info(
      `[TOOLS] External MCP tools found: ${matchedExternal.map((t) => t.name).join(', ')}`
    );
  }

  return [...localTools, ...matchedExternal];
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
