interface ApiContext {
  memoryTable: sst.aws.Dynamo;
  traceTable: sst.aws.Dynamo;
  configTable: sst.aws.Dynamo;
  stagingBucket: sst.aws.Bucket;
  secrets: Record<string, sst.Secret>;
  bus: sst.aws.Bus;
  deployer: aws.codebuild.Project;
}

export function createApi(ctx: ApiContext) {
  const { memoryTable, traceTable, configTable, stagingBucket, secrets, bus, deployer } = ctx;

  const api = new sst.aws.ApiGatewayV2('WebhookApi');

  // Filter out any undefined secrets before linking
  const validSecrets = Object.values(secrets).filter((s) => s !== undefined);

  // Main Webhook
  api.route('ANY /webhook', {
    handler: 'core/handlers/webhook.handler',
    link: [memoryTable, traceTable, configTable, stagingBucket, ...validSecrets, deployer, bus],
    timeout: '29 seconds',
  });

  // GitHub Webhook for Renovate/MendBot
  api.route('POST /github/webhook', {
    handler: 'core/handlers/renobot.handler',
    link: [memoryTable, traceTable, configTable, ...validSecrets, deployer, bus],
    timeout: '29 seconds',
  });

  // Health Probe
  api.route('GET /health', {
    handler: 'core/handlers/health.handler',
    link: [memoryTable],
  });

  return { api };
}
