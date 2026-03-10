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

  // Main Webhook
  api.route('ANY /webhook', {
    handler: 'src/agents/webhook.handler',
    link: [
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      ...Object.values(secrets),
      deployer,
      bus,
    ],
    timeout: '29 seconds',
  });

  // GitHub Webhook for Renovate/MendBot
  api.route('POST /github/webhook', {
    handler: 'src/agents/renobot.handler',
    link: [memoryTable, traceTable, configTable, ...Object.values(secrets), deployer, bus],
    timeout: '29 seconds',
  });

  // Health Probe
  api.route('GET /health', {
    handler: 'src/agents/health.handler',
    link: [memoryTable],
  });

  return { api };
}
