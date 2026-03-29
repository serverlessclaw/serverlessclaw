/**
 * @module ToolRegistry
 * Centralized registry for all agent tools, aggregating specialized capabilities from across the system.
 */
import { ITool } from '../lib/types/tool';

// Import domain registries
import { knowledgeTools } from './knowledge';
import { collaborationTools } from './collaboration';
import { infraTools } from './infra';
import { systemTools } from './system';

/**
 * Registry of all available tools for agents to execute.
 * Aggregates tools from domain-driven subdirectories.
 */
export const TOOLS: Record<string, ITool> = {
  ...knowledgeTools,
  ...collaborationTools,
  ...infraTools,
  ...systemTools,
};

console.log(
  `[TOOLS] Registry initialized with ${Object.keys(TOOLS).length} tools: ${Object.keys(TOOLS).join(', ')}`
);

/**
 * Utility for retrieving tools associated with a specific agent.
 */
export { getAgentTools, getToolDefinitions } from './registry-utils';
