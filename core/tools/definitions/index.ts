import { IToolDefinition } from '../../lib/types/index';
import { deploymentTools } from './deployment';
import { agentTools } from './agent';
import { knowledgeTools } from './knowledge';
import { configTools } from './config';
import { mcpTools } from './mcp';
import { skillsTools } from './skills';
import { systemTools } from './system';
import { clarificationTools } from './clarification';
import { schedulerDefinitions } from './scheduler';
import { metadataTools } from './metadata';
import { gitTools } from './git';
import { orchestrationTools } from './orchestration';

/**
 * Combined tool definitions for all system tools.
 * These definitions are used by LLMs to understand how to invoke each tool.
 * All tool names follow standard JavaScript camelCase naming conventions.
 */
export const toolDefinitions: Record<string, IToolDefinition> = {
  ...deploymentTools,
  ...agentTools,
  ...knowledgeTools,
  ...configTools,
  ...mcpTools,
  ...skillsTools,
  ...systemTools,
  ...clarificationTools,
  ...schedulerDefinitions,
  ...metadataTools,
  ...gitTools,
  ...orchestrationTools,
};

// Re-export individual tool categories for modular access
export {
  deploymentTools,
  agentTools,
  knowledgeTools,
  configTools,
  mcpTools,
  skillsTools,
  systemTools,
  clarificationTools,
  schedulerDefinitions,
  metadataTools,
  gitTools,
  orchestrationTools,
};
