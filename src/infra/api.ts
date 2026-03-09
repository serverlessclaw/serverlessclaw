interface ApiContext {
  memoryTable: sst.aws.Dynamo;
  traceTable: sst.aws.Dynamo;
  stagingBucket: sst.aws.Bucket;
  secrets: Record<string, sst.Secret>;
  bus: sst.aws.Bus;
  deployer: aws.codebuild.Project;
}

export function createApi(ctx: ApiContext) {
  const { memoryTable, traceTable, stagingBucket, secrets, bus, deployer } = ctx;

  const api = new sst.aws.ApiGatewayV2('WebhookApi');

  // Main Webhook
  api.route('ANY /webhook', {
    handler: 'src/agents/webhook.handler',
    link: [memoryTable, traceTable, stagingBucket, ...Object.values(secrets), deployer, bus],
  });

  // Health Probe
  api.route('GET /health', {
    handler: 'src/agents/health.handler',
    link: [memoryTable],
  });

  return { api };
}
