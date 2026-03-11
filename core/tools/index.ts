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
 */
export const tools: Record<string, ITool> = {
  // System & Deployment Tools
  ...systemTools,

  // File System & Validation Tools
  ...fsTools,

  // Knowledge & Agent Management Tools
  ...knowledgeTools,

  /**
   * Evaluates a mathematical expression safely.
   */
  calculator: {
    ...toolDefinitions.calculator,
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const { expression } = args as { expression: string };
      try {
        const result = Function(`"use strict"; return (${expression})`)();
        return `Result: ${result}`;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },

  /**
   * Switches the active LLM provider and model for the system.
   */
  switch_model: {
    ...toolDefinitions.switch_model,
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const { provider, model } = args as { provider: string; model: string };
      try {
        const { AgentRegistry } = await import('../lib/registry');
        await AgentRegistry.saveConfig('active_provider', provider as any);
        await AgentRegistry.saveConfig('active_model', model as any);
        return `Successfully switched to ${provider} with model ${model}. Hot config applied.`;
      } catch (error) {
        return `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
};

/**
 * Dynamically retrieves the tools assigned to a specific agent.
 * Uses the AgentRegistry to get tools from both Backbone and DDB.
 * 
 * @param agentId - The ID of the agent to fetch tools for.
 * @returns A promise that resolves to an array of ITool implementations.
 */
export async function getAgentTools(agentId: string): Promise<ITool[]> {
  const { AgentRegistry } = await import('../lib/registry');
  const config = await AgentRegistry.getAgentConfig(agentId);

  if (!config || !config.tools) {
    logger.warn(`No tools configured for agent ${agentId}, returning empty set.`);
    return [];
  }

  return config.tools
    .map((name: string) => (tools as Record<string, ITool>)[name])
    .filter((t: ITool | undefined): t is ITool => !!t);
}

/**
 * Generates an array of tool definitions for use in LLM calls.
 * 
 * @returns Array of function definitions.
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
