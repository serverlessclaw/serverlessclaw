import { SharedContext, getDomainConfig, AGENT_CONFIG, getValidSecrets } from './shared';

/**
 * Deploys the Next.js dashboard for monitoring and managing the agents.
 *
 * @param ctx - The shared context containing system resources.
 * @returns An object containing the created dashboard resource.
 */
export function createDashboard(ctx: SharedContext): { dashboard: sst.aws.Nextjs } {
  const {
    memoryTable,
    traceTable,
    configTable,
    stagingBucket,
    knowledgeBucket,
    bus,
    deployer,
    api,
  } = ctx;

  const dashboardDomain = getDomainConfig('dashboard');
  const dashboard = new sst.aws.Nextjs('ClawCenter', {
    domain: dashboardDomain,
    path: 'dashboard',
    link: [
      memoryTable,
      traceTable,
      configTable,
      bus,
      ...(api ? [api] : []),
      ...(ctx.realtime ? [ctx.realtime] : []),
      ...getValidSecrets(ctx.secrets),
    ],
    environment: {
      AWS_PROFILE: '', // Clear profile to avoid conflict warning as SST injects static credentials
      DEPLOYER_NAME: deployer.name,
      DYNAMIC_SCHEDULER_ROLE_ARN: ctx.schedulerRole!.arn,
      HEARTBEAT_HANDLER_ARN: ctx.heartbeatHandler!.arn,
      API_URL: api?.url || '',
      STAGING_BUCKET_NAME: stagingBucket.name,
      KNOWLEDGE_BUCKET_NAME: knowledgeBucket.name,
      BUS_NAME: bus.name,
    },
    server: {
      memory: AGENT_CONFIG.memory.LARGE,
      timeout: AGENT_CONFIG.timeout.MAX,
    },
    permissions: [
      {
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:DeleteObject'],
        resources: [
          ctx.stagingBucket.arn,
          $util.interpolate`${ctx.stagingBucket.arn}/*`,
          ctx.knowledgeBucket.arn,
          $util.interpolate`${ctx.knowledgeBucket.arn}/*`,
        ],
      },
      {
        actions: ['events:PutEvents'],
        resources: [ctx.bus.arn],
      },
      {
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:DeleteSchedule',
          'scheduler:GetSchedule',
          'scheduler:ListSchedules',
          'scheduler:UpdateSchedule',
        ],
        resources: ['*'],
      },
      {
        actions: ['iam:PassRole'],
        resources: [ctx.schedulerRole!.arn],
      },
      {
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      },
    ],
    transform: {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cdn: (args: any) => {
        // 1. Ensure the server origin uses https-only (fixes 502/origin issues)
        if (args.origins) {
          args.origins = $util.output(args.origins).apply(
            (
              /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
              origins: any[]
            ) =>
              /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
              origins.map((origin: any) => {
                if (origin.customOriginConfig) {
                  return {
                    ...origin,
                    customOriginConfig: {
                      ...origin.customOriginConfig,
                      originProtocolPolicy: 'https-only',
                    },
                  };
                }
                return origin;
              })
          );
        }

        // 2. Add Viewer Request Function for enhanced routing
        // This ensures URIs are correctly mapped to S3/Image Optimizer
        const routingFunction = new aws.cloudfront.Function('ClawCenterRouter', {
          runtime: 'cloudfront-js-2.0',
          code: `
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Next.js requirement: Forward host header for proper routing
  request.headers["x-forwarded-host"] = { value: request.headers.host.value };

  return request;
}
`,
        });

        // Associate the function with the default cache behavior
        if (args.defaultCacheBehavior) {
          args.defaultCacheBehavior = $util.output(args.defaultCacheBehavior).apply((behavior) => ({
            ...behavior,
            functionAssociations: [
              ...(behavior.functionAssociations || []),
              {
                eventType: 'viewer-request',
                functionArn: routingFunction.arn,
              },
            ],
          }));
        }
      },
    },
  });

  return { dashboard };
}
