import { SharedContext, getValidSecrets, AGENT_CONFIG } from './shared';

/**
 * Initializes the main API Gateway and its routes.
 *
 * @param ctx - The shared context containing system resources.
 * @returns An object containing the created API resource.
 */
export function createApi(ctx: SharedContext): { api: sst.aws.ApiGatewayV2 } {
  const { memoryTable, traceTable, configTable, stagingBucket, secrets, bus, deployer } = ctx;

  const api = new sst.aws.ApiGatewayV2('WebhookApi');

  const validSecrets = getValidSecrets(secrets);

  // Main Webhook
  api.route('ANY /webhook', {
    handler: 'core/handlers/webhook.handler',
    link: [memoryTable, traceTable, configTable, stagingBucket, ...validSecrets, deployer, bus],
    timeout: AGENT_CONFIG.timeout.SHORT,
    logging: {
      retention: '30 days',
    },
  });

  // Health Probe
  api.route('GET /health', {
    handler: 'core/handlers/health.handler',
    link: [memoryTable],
    logging: {
      retention: '30 days',
    },
  });

  return { api };
}
