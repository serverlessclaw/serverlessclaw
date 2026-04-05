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

  const dashboard = new sst.aws.Nextjs('ClawCenter', {
    path: 'dashboard',
    domain: getDomainConfig('dashboard'),
    link: [
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      knowledgeBucket,
      bus,
      deployer, // Added for topology discovery
      ...(api ? [api] : []),
      ...(ctx.realtime ? [ctx.realtime] : []),
      ...(ctx.multiplexer ? [ctx.multiplexer] : []), // Added for topology discovery
      ...getValidSecrets(ctx.secrets),
    ],
    environment: {
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
      timeout: AGENT_CONFIG.timeout.LONG,
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
  });

  return { dashboard };
}
