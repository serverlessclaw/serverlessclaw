/**
 * @module ToolRegistry
 * Centralized registry for all agent tools, aggregating specialized capabilities from across the system.
 */
import { toolDefinitions } from './definitions/index';
import { ITool } from '../lib/types/tool';
import { formatErrorMessage } from '../lib/utils/error';
import { CONFIG_KEYS } from '../lib/constants';

// Import split tool implementations
import * as deploymentTools from './deployment';
import * as rollbackTools from './rollback';
import * as fsTools from './fs';
import * as knowledgeAgentTools from './knowledge-agent';
import * as knowledgeStorageTools from './knowledge-storage';
import * as knowledgeMcpTools from './knowledge-mcp';
import * as schedulerTools from './scheduler';
import * as metadataTools from './metadata';
import * as debugTools from './debug';
import * as validationTools from './validation';
import * as gitTools from './git';
import * as orchestrationTools from './orchestration';
import * as collaborationTools from './collaboration';

// Consolidate knowledge tools
const knowledgeTools = {
  ...knowledgeAgentTools,
  ...knowledgeStorageTools,
  ...knowledgeMcpTools,
};

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
      k.includes('_') ? k.toLowerCase().replace(/_([a-z])/g, (_, p1) => p1.toUpperCase()) : k,
      v,
    ])
  ),
  ...Object.fromEntries(
    Object.entries(rollbackTools).map(([k, v]) => [
      k.includes('_') ? k.toLowerCase().replace(/_([a-z])/g, (_, p1) => p1.toUpperCase()) : k,
      v,
    ])
  ),
  ...Object.fromEntries(
    Object.entries(validationTools).map(([k, v]) => [
      k.includes('_') ? k.toLowerCase().replace(/_([a-z])/g, (_, p1) => p1.toUpperCase()) : k,
      v,
    ])
  ),
  ...Object.fromEntries(
    Object.entries(gitTools).map(([k, v]) => [
      k.includes('_') ? k.toLowerCase().replace(/_([a-z])/g, (_, p1) => p1.toUpperCase()) : k,
      v,
    ])
  ),
  ...Object.fromEntries(
    Object.entries(orchestrationTools).map(([k, v]) => [
      k.includes('_') ? k.toLowerCase().replace(/_([a-z])/g, (_, p1) => p1.toUpperCase()) : k,
      v,
    ])
  ),
  ...Object.fromEntries(
    Object.entries(collaborationTools).map(([k, v]) => [
      k.includes('_') ? k.toLowerCase().replace(/_([a-z])/g, (_, p1) => p1.toUpperCase()) : k,
      v,
    ])
  ),

  // File System & Validation Tools
  ...Object.fromEntries(
    Object.entries(fsTools).map(([k, v]) => [
      k.includes('_') ? k.toLowerCase().replace(/_([a-z])/g, (_, p1) => p1.toUpperCase()) : k,
      v,
    ])
  ),

  // Knowledge & Agent Management Tools
  ...Object.fromEntries(
    Object.entries(knowledgeToolsFiltered).map(([k, v]) => [
      k.includes('_') ? k.toLowerCase().replace(/_([a-z])/g, (_, p1) => p1.toUpperCase()) : k,
      v,
    ])
  ),

  // Scheduler Tools
  ...Object.fromEntries(
    Object.entries(schedulerTools).map(([k, v]) => [
      k.includes('_') ? k.toLowerCase().replace(/_([a-z])/g, (_, p1) => p1.toUpperCase()) : k,
      v,
    ])
  ),

  // Debug & Metadata Tools
  ...Object.fromEntries(
    Object.entries(metadataTools).map(([k, v]) => [
      k.includes('_') ? k.toLowerCase().replace(/_([a-z])/g, (_, p1) => p1.toUpperCase()) : k,
      v,
    ])
  ),
  ...Object.fromEntries(
    Object.entries(debugTools).map(([k, v]) => [
      k.includes('_') ? k.toLowerCase().replace(/_([a-z])/g, (_, p1) => p1.toUpperCase()) : k,
      v,
    ])
  ),

  /**
   * Switches the active LLM provider and model for the system.
   * This update is persisted to the ConfigTable and takes effect immediately
   * for all subsequent agent invocations.
   */
  switchModel: {
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

console.log(
  `[TOOLS] Registry initialized with ${Object.keys(TOOLS).length} tools: ${Object.keys(TOOLS).join(', ')}`
);

/**
 * Utility for retrieving tools associated with a specific agent.
 */
export { getAgentTools, getToolDefinitions } from './registry-utils';
