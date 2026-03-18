/**
 * Represents the shared resource context passed between infrastructure modules.
 */
export interface SharedContext {
  memoryTable: sst.aws.Dynamo;
  traceTable: sst.aws.Dynamo;
  configTable: sst.aws.Dynamo;
  stagingBucket: sst.aws.Bucket;
  knowledgeBucket: sst.aws.Bucket;
  secrets: Record<string, sst.Secret>;
  bus: sst.aws.Bus;
  deployer: aws.codebuild.Project;
  api?: sst.aws.ApiGatewayV2;
  realtime?: sst.aws.Realtime;
  heartbeatHandler?: sst.aws.Function;
  schedulerRole?: aws.iam.Role;
}

/**
 * Filter out any undefined secrets before linking to resources.
 *
 * @param secrets - A record of secret names to SST Secret objects.
 * @returns An array of valid (non-undefined) SST Secret objects.
 */
export function getValidSecrets(secrets: Record<string, sst.Secret>): sst.Secret[] {
  return Object.values(secrets).filter((s) => s !== undefined);
}

/**
 * Common configuration for agent functions
 */
export const AGENT_CONFIG = {
  memory: {
    SMALL: '256 MB',
    MEDIUM: '512 MB',
    LARGE: '2048 MB',
  },
  timeout: {
    SHORT: '30 seconds',
    MEDIUM: '60 seconds',
    LONG: '600 seconds',
    MAX: '900 seconds',
  },
} as const;

/**
 * Returns the optional domain configuration for a component.
 *
 * @param component - The component to get the domain for ('api' | 'dashboard' | 'router').
 * @returns The domain configuration or undefined if not set.
 */
export function getDomainConfig(
  component: 'api' | 'dashboard' | 'router'
): string | { name: string; dns: ReturnType<typeof sst.cloudflare.dns> } | undefined {
  const envVarMap: Record<string, string> = {
    api: 'CLAW_DOMAIN_API',
    dashboard: 'CLAW_DOMAIN_DASHBOARD',
    router: 'CLAW_DOMAIN_ROUTER',
  };
  const envVar = envVarMap[component];
  const domain = process.env[envVar];

  if (!domain) return undefined;

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (zoneId) {
    return {
      name: domain,
      dns: sst.cloudflare.dns({
        zone: zoneId,
      }),
    };
  }

  return domain;
}
