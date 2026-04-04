import * as agentTools from './agent';
import * as storageTools from './storage';
import * as mcpTools from './mcp';
import * as metadataTools from './metadata';
import * as configTools from './config';
import * as researchTools from './research';

/**
 * Knowledge Domain Tool Registry
 */
export const knowledgeTools = {
  ...agentTools,
  ...storageTools,
  ...mcpTools,
  ...metadataTools,
  ...configTools,
  ...researchTools,
};

export { knowledgeSchema } from './schema';
