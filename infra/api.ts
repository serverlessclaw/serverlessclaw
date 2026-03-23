import { SharedContext, getValidSecrets, AGENT_CONFIG, getDomainConfig } from './shared';

/**
 * Initializes the main API Gateway and its routes.
 *
 * @param ctx - The shared context containing system resources.
 * @returns An object containing the created API resource.
 */
export function createApi(ctx: SharedContext): { api: sst.aws.ApiGatewayV2 } {
  const {
    memoryTable,
    traceTable,
    configTable,
    stagingBucket,
    knowledgeBucket,
    secrets,
    bus,
    deployer,
  } = ctx;

  const apiDomain = getDomainConfig('api');
  const api = new sst.aws.ApiGatewayV2('WebhookApi', {
    domain: apiDomain,
  });

  const validSecrets = getValidSecrets(secrets);

  // Global permissions for all API routes (if needed)
  const apiPermissions = [
    {
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    },
  ];

  // Main Webhook
  api.route('ANY /webhook', {
    handler: 'core/handlers/webhook.handler',
    nodejs: { loader: { '.md': 'text' } },
    link: [
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      knowledgeBucket,
      ...validSecrets,
      deployer,
      bus,
    ],
    permissions: apiPermissions,
    timeout: AGENT_CONFIG.timeout.SHORT,
    logging: {
      retention: '1 month',
    },
  });

  // Health Probe
  api.route('GET /health', {
    handler: 'core/handlers/health.handler',
    nodejs: { loader: { '.md': 'text' } },
    link: [memoryTable, traceTable, configTable, stagingBucket, knowledgeBucket, bus],
    permissions: [
      ...apiPermissions,
      {
        actions: ['events:ListEventBuses'],
        resources: ['*'],
      },
    ],
    environment: {
      GIT_HASH: process.env.GIT_HASH || 'dev',
    },
    logging: {
      retention: '1 month',
    },
  });

  return { api };
}
