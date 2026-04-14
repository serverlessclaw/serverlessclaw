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
    deployerLink,
    api,
    schedulerRole,
    heartbeatHandler,
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
      deployerLink, // Added for topology discovery
      ...(api ? [api] : []),
      ...(ctx.realtime ? [ctx.realtime] : []),
      ...(ctx.multiplexer ? [ctx.multiplexer] : []), // Added for topology discovery
      ...getValidSecrets(ctx.secrets),
    ],
    environment: {
      DEPLOYER_NAME: deployer.name,
      DYNAMIC_SCHEDULER_ROLE_ARN: schedulerRole!.arn,
      HEARTBEAT_HANDLER_ARN: heartbeatHandler!.arn,
      API_URL: api?.url || '',
      STAGING_BUCKET_NAME: stagingBucket.name,
      KNOWLEDGE_BUCKET_NAME: knowledgeBucket.name,
      BUS_NAME: bus.name,
      AWS_PROFILE: '', // Clear profile to avoid conflict warning as SST injects static credentials
    },
    server: {
      memory: AGENT_CONFIG.memory.LARGE,
      timeout: AGENT_CONFIG.timeout.LONG,
    },

    permissions: [
      {
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:DeleteObject'],
        resources: [
          stagingBucket.arn,
          $util.interpolate`${stagingBucket.arn}/*`,
          knowledgeBucket.arn,
          $util.interpolate`${knowledgeBucket.arn}/*`,
        ],
      },
      {
        actions: ['events:PutEvents'],
        resources: [bus.arn],
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
        resources: [schedulerRole!.arn],
      },
      {
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      },
    ],
  });

  return { dashboard };
}
