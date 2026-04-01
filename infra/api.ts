import { SharedContext, getValidSecrets, AGENT_CONFIG, getDomainConfig } from './shared';

/** Lambda runtime architecture for all API functions */
const LAMBDA_ARCHITECTURE = 'arm64';

/** Node.js loader configuration for markdown files */
const NODEJS_LOADERS = { '.md': 'text' } as const;

/** Default log retention period for Lambda functions */
const LOG_RETENTION_PERIOD = '1 month';

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
  const api = new sst.aws.ApiGatewayV2('WebhookApiV2', {
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
  const criticalAgents = ctx.agents
    ? [
        ctx.agents.plannerAgent,
        ctx.agents.coderAgent,
        ctx.agents.reflectorAgent,
        ctx.agents.qaAgent,
        ctx.agents.mergerAgent,
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
    environment: {
      GIT_HASH: process.env.GIT_HASH || 'dev',
    },
    logging: {
      retention: LOG_RETENTION_PERIOD,
    },
  });

  return { api };
}
