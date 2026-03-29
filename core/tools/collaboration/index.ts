import * as workspaceTools from './workspace';
import * as collaborationToolsExports from './collaboration';
import * as messagingTools from './messaging';
import * as clarificationTools from './clarification';

/**
 * Collaboration Domain Tool Registry
 */
export const collaborationTools = {
  ...workspaceTools,
  ...collaborationToolsExports,
  ...messagingTools,
  ...clarificationTools,
};

export { collaborationSchema } from './schema';
