import {
  SharedContext,
  getValidSecrets,
  AGENT_CONFIG,
  getDomainConfig,
  LAMBDA_ARCHITECTURE,
  NODEJS_LOADERS,
  LOG_RETENTION_PERIOD,
} from './shared';

/**
 * Initializes the main API Gateway.
 *
 * @param ctx - The shared context (without agents).
 * @returns An object containing the created API resource.
 */
export function createApi(_ctx: SharedContext): { api: sst.aws.ApiGatewayV2 } {
  const apiDomain = getDomainConfig('api');
  const api = new sst.aws.ApiGatewayV2('WebhookApi', {
    domain: apiDomain,
  });

  return { api };
}

/**
 * Configures the routes for the API Gateway.
 * This is called after the agents have been created to allow linking.
 *
 * @param api - The API Gateway instance.
 * @param ctx - The shared context containing agents and other resources.
 */
export function configureApiRoutes(api: sst.aws.ApiGatewayV2, ctx: SharedContext): void {
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

  const validSecrets = getValidSecrets(secrets);

  // Global permissions for all API routes (if needed)
  const apiPermissions = [
    {
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    },
  ];

  // Main Webhook
  const agents = ctx.agents as Record<string, sst.aws.Function> | undefined;
  const criticalAgents = agents
    ? [
        agents.plannerAgent,
        agents.coderAgent,
        agents.reflectorAgent,
        agents.qaAgent,
        agents.mergerAgent,
      ].filter(Boolean)
    : [];

  api.route('ANY /webhook', {
    handler: 'core/handlers/webhook.handler',
    nodejs: { loader: NODEJS_LOADERS },
    link: [
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      knowledgeBucket,
      ...validSecrets,
      deployer,
      bus,
      ...criticalAgents,
    ],
    environment: {
      // Pass the function names for the warm-up utility
      WARM_UP_FUNCTIONS: JSON.stringify(criticalAgents.map((a) => a.name)),
    },
    permissions: [
      ...apiPermissions,
      {
        actions: ['lambda:InvokeFunction'],
        resources: criticalAgents.map((a) => a.arn),
      },
    ],
    architecture: LAMBDA_ARCHITECTURE,
    timeout: AGENT_CONFIG.timeout.SHORT,
    logging: {
      retention: LOG_RETENTION_PERIOD,
    },
  });

  // Health Probe
  api.route('GET /health', {
    handler: 'core/handlers/health.handler',
    nodejs: { loader: NODEJS_LOADERS },
    link: [memoryTable, traceTable, configTable, stagingBucket, knowledgeBucket, bus],
    permissions: [
      ...apiPermissions,
      {
        actions: ['events:ListEventBuses'],
        resources: ['*'],
      },
    ],
    architecture: LAMBDA_ARCHITECTURE,
    memory: '128 MB',
    timeout: AGENT_CONFIG.timeout.SHORT,
    environment: {
      GIT_HASH: process.env.GIT_HASH || 'dev',
    },
    logging: {
      retention: LOG_RETENTION_PERIOD,
    },
  });
}
