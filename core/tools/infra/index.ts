import * as deploymentTools from './deployment';
import * as rollbackTools from './rollback';
import * as schedulerTools from './scheduler';
import * as topologyTools from './topology';
import * as orchestrationTools from './orchestration';

/**
 * Infra Domain Tool Registry
 */
export const infraTools = {
  ...deploymentTools,
  ...rollbackTools,
  ...schedulerTools,
  ...topologyTools,
  ...orchestrationTools,
};

export { infraSchema } from './schema';
