import { toolDefinitions } from './definitions/index';
import { logger } from '../lib/logger';
import { ITool } from '../lib/types/index';
import { formatErrorMessage } from '../lib/utils/error';
import { CONFIG_KEYS } from '../lib/constants';

// Import split tool implementations
import * as deploymentTools from './deployment';
import * as rollbackTools from './rollback';
import * as fsTools from './fs';
import * as knowledgeTools from './knowledge';
import * as schedulerTools from './scheduler';
import * as metadataTools from './metadata';

// Filter knowledgeTools to only include ITool exports (exclude utility functions like formatErrorMessage)
const knowledgeToolEntries = Object.entries(knowledgeTools).filter(
  ([, value]) => typeof value === 'object' && value !== null && 'execute' in value
);
const knowledgeToolsFiltered = Object.fromEntries(knowledgeToolEntries) as Record<string, ITool>;

/**
 * Registry of all available tools for agents to execute.
 * Aggregates tools from specialized modules (system, fs, knowledge).
 * All tool names follow standard JavaScript camelCase naming conventions.
 */
export const TOOLS: Record<string, ITool> = {
  // System & Deployment Tools
  ...Object.fromEntries(
    Object.entries(deploymentTools).map(([k, v]) => [
      k.toLowerCase().replace(/_([a-z])/g, (g) => g[1]),
      v,
    ])
  ),
  ...Object.fromEntries(
    Object.entries(rollbackTools).map(([k, v]) => [
      k.toLowerCase().replace(/_([a-z])/g, (g) => g[1]),
      v,
    ])
  ),

  // File System & Validation Tools
  ...Object.fromEntries(
    Object.entries(fsTools).map(([k, v]) => [k.toLowerCase().replace(/_([a-z])/g, (g) => g[1]), v])
  ),

  // Knowledge & Agent Management Tools
  ...Object.fromEntries(
    Object.entries(knowledgeToolsFiltered).map(([k, v]) => [
      k.toLowerCase().replace(/_([a-z])/g, (g) => g[1]),
      v,
    ])
  ),

  // Proactive Scheduling Tools
  ...Object.fromEntries(
    Object.entries(schedulerTools).map(([k, v]) => [
      k.toLowerCase().replace(/_([a-z])/g, (g) => g[1]),
      v,
    ])
  ),

  // Metadata & SSOT Tools
  ...Object.fromEntries(
    Object.entries(metadataTools).map(([k, v]) => [
      k.toLowerCase().replace(/_([a-z])/g, (g) => g[1]),
      v,
    ])
  ),

  /**
   * Switches the active LLM provider and model for the system.
   */
  SWITCH_MODEL: {
    ...toolDefinitions.switchModel,
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const { provider, model } = args as { provider: string; model: string };
      try {
        const { AgentRegistry } = await import('../lib/registry');
        await AgentRegistry.saveRawConfig(CONFIG_KEYS.ACTIVE_PROVIDER, provider);
        await AgentRegistry.saveRawConfig(CONFIG_KEYS.ACTIVE_MODEL, model);
        return `Successfully switched to ${provider} with model ${model}. Hot config applied.`;
      } catch (error) {
        return `Failed to switch model: ${formatErrorMessage(error)}`;
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
    .map((name: string) => (TOOLS as Record<string, ITool>)[name])
    .filter((t: ITool | undefined): t is ITool => !!t);

  // 2. Resolve external MCP tools if any match the requested tool names
  const externalTools = await MCPBridge.getExternalTools(config.tools);
  const matchedExternal = externalTools.filter((t) => config.tools!.includes(t.name));

  return [...localTools, ...matchedExternal];
}

/**
 * Generates an array of tool definitions for use in LLM completion calls.
 *
 * @returns Array of function definitions formatted for LLM tool selection.
 */
export function getToolDefinitions() {
  return Object.values(TOOLS).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
