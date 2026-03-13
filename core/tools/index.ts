import { toolDefinitions } from './definitions';
import { logger } from '../lib/logger';
import { ITool } from '../lib/types/index';

// Import split tool implementations
import * as systemTools from './system';
import * as fsTools from './fs';
import * as knowledgeTools from './knowledge';

/**
 * Registry of all available tools for agents to execute.
 * Aggregates tools from specialized modules (system, fs, knowledge).
 * All tool names follow standard JavaScript camelCase naming conventions.
 */
export const tools: Record<string, ITool> = {
  // System & Deployment Tools
  ...systemTools,

  // File System & Validation Tools
  ...fsTools,
  // Knowledge & Agent Management Tools
  ...knowledgeTools,

  /**
   * Switches the active LLM provider and model for the system.
   */
  switchModel: {
    ...toolDefinitions.switchModel,
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const { provider, model } = args as { provider: string; model: string };
      try {
        const { AgentRegistry } = await import('../lib/registry');
        await AgentRegistry.saveRawConfig('active_provider', provider);
        await AgentRegistry.saveRawConfig('active_model', model);
        return `Successfully switched to ${provider} with model ${model}. Hot config applied.`;
      } catch (error) {
        return `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
};

/**
 * Dynamically retrieves the tools assigned to a specific agent.
 * Uses the AgentRegistry to get tools from both Backbone and DynamoDB.
 * Now also dynamically resolves external MCP tools if they are in the agent's toolset.
 *
 * @param agentId - The ID of the agent to fetch tools for.
 * @returns A promise that resolves to an array of ITool implementations.
 */
export async function getAgentTools(agentId: string): Promise<ITool[]> {
  const { AgentRegistry } = await import('../lib/registry');
  const { MCPBridge } = await import('../lib/mcp');

  const config = await AgentRegistry.getAgentConfig(agentId);

  if (!config || !config.tools) {
    logger.warn(`No tools configured for agent ${agentId}, returning empty set.`);
    return [];
  }

  // 1. Resolve local tools
  const localTools = config.tools
    .map((name: string) => (tools as Record<string, ITool>)[name])
    .filter((t: ITool | undefined): t is ITool => !!t);

  // 2. Resolve external MCP tools if any match the requested tool names
  const externalTools = await MCPBridge.getAllExternalTools();
  const matchedExternal = externalTools.filter((t) => config.tools!.includes(t.name));

  return [...localTools, ...matchedExternal];
}

/**
 * Generates an array of tool definitions for use in LLM completion calls.
 *
 * @returns Array of function definitions formatted for LLM tool selection.
 */
export function getToolDefinitions() {
  return Object.values(tools).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
