import * as fsTools from './fs';
import * as gitTools from './git';
import * as healthTools from './health';
import * as validationTools from './validation';
import * as hotConfigTools from './hot-config';
import * as reputationTools from './reputation';

/**
 * System Domain Tool Registry
 */
export const systemTools = {
  ...fsTools,
  ...gitTools,
  ...healthTools,
  ...validationTools,
  ...hotConfigTools,
  ...reputationTools,
};

export { systemSchema } from './schema';
