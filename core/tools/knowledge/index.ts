import * as agentTools from './agent';
import * as storageTools from './storage';
import * as mcpTools from './mcp';
import * as metadataTools from './metadata';
import * as configTools from './config';

/**
 * Knowledge Domain Tool Registry
 */
export const knowledgeTools = {
  ...agentTools,
  ...storageTools,
  ...mcpTools,
  ...metadataTools,
  ...configTools,
};

export { knowledgeSchema } from './schema';
