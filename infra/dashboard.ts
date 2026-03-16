import { SharedContext, getValidSecrets, getDomainConfig, AGENT_CONFIG } from './shared';

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
    secrets,
    bus,
    deployer,
    api,
    realtime,
  } = ctx;

  const validSecrets = getValidSecrets(secrets);

  const dashboardDomain = getDomainConfig('dashboard');
  const dashboard = new sst.aws.Nextjs('ClawCenter', {
    domain: dashboardDomain,
    path: 'dashboard',
    link: [
      memoryTable,
      traceTable,
      configTable,
      stagingBucket,
      knowledgeBucket,
      ...validSecrets,
      bus,
      deployer,
      api!,
      realtime!,
    ],
    server: {
      memory: AGENT_CONFIG.memory.LARGE,
      timeout: AGENT_CONFIG.timeout.MAX,
    },
    permissions: [
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
    ],
  });

  return { dashboard };
}
