import { SharedContext, getValidSecrets } from './shared';

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
    secrets,
    bus,
    deployer,
    api,
    realtime,
  } = ctx;

  const validSecrets = getValidSecrets(secrets);

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
      api!,
      realtime!,
    ],
  });

  return { dashboard };
}
