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

  const dashboard = new sst.aws.Nextjs('AdminDashboard', {
    path: 'dashboard',
    link: [
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      ...Object.values(secrets),
      bus,
      deployer,
      api,
    ],
  });

  return { dashboard };
}
