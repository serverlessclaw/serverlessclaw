/**
 * @module ToolRegistry
 * Centralized registry for all agent tools, aggregating specialized capabilities from across the system.
 */
import { ITool } from '../lib/types/tool';

/**
 * Registry of all available tools for agents to execute.
 * Lazily aggregated to keep context budget low.
 */
export const TOOLS: Record<string, ITool> = {};

/**
 * Initialize the full tools registry.
 * This should only be called when all tools are needed.
 */
export async function initializeTools(): Promise<Record<string, ITool>> {
  if (Object.keys(TOOLS).length > 0) return TOOLS;

  const [{ getKnowledgeTools }, { getCollaborationTools }, { getInfraTools }, { getSystemTools }] =
    await Promise.all([
      import('./knowledge'),
      import('./collaboration'),
      import('./infra'),
      import('./system'),
    ]);

  const [knowledge, collaboration, infra, system] = await Promise.all([
    getKnowledgeTools(),
    getCollaborationTools(),
    getInfraTools(),
    getSystemTools(),
  ]);

  const { PluginManager } = await import('../lib/plugin-manager');
  const pluginTools = PluginManager.getRegisteredTools();

  Object.assign(TOOLS, {
    ...knowledge,
    ...collaboration,
    ...infra,
    ...system,
    ...pluginTools,
  });

  return TOOLS;
}

/**
 * Utility for retrieving tools associated with a specific agent.
 */
export { getAgentTools, getToolDefinitions } from './registry-utils';
