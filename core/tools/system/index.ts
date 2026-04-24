import * as gitTools from './git';
import * as healthTools from './health';
import * as validationTools from './validation';
import * as hotConfigTools from './hot-config';
import * as reputationTools from './reputation';
import * as uiTools from './ui';
import * as governanceTools from './governance';
import * as workflowTools from './workflow';

/**
 * System Domain Tool Registry
 */
export const systemTools = {
  ...gitTools,
  ...healthTools,
  ...validationTools,
  ...hotConfigTools,
  ...reputationTools,
  ...uiTools,
  ...governanceTools,
  ...workflowTools,
};

export { systemSchema } from './schema';
