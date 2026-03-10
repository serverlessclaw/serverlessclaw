interface DashboardContext {
  memoryTable: sst.aws.Dynamo;
  traceTable: sst.aws.Dynamo;
  configTable: sst.aws.Dynamo;
  stagingBucket: sst.aws.Bucket;
  secrets: Record<string, sst.Secret>;
  bus: sst.aws.Bus;
  deployer: aws.codebuild.Project;
  api: sst.aws.ApiGatewayV2;
}

export function createDashboard(ctx: DashboardContext) {
  const { memoryTable, traceTable, configTable, stagingBucket, secrets, bus, deployer, api } = ctx;

  const validSecrets = Object.values(secrets).filter((s) => s !== undefined);

  const dashboard = new sst.aws.Nextjs('ClawCenter', {
    path: 'dashboard',
    link: [
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      ...validSecrets,
      bus,
      deployer,
      api,
    ],
  });

  return { dashboard };
}
