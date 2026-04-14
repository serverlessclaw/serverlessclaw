/**
 * Represents the record of autonomous agent function resources.
 * Defined here to avoid circular dependencies between agents.ts and shared.ts.
 */
export interface AgentFunctionResources {
  coderAgent: sst.aws.Function;
  buildMonitor: sst.aws.Function;
  eventHandler: sst.aws.Function;
  deadMansSwitch: sst.aws.Function;
  plannerAgent: sst.aws.Function;
  reflectorAgent: sst.aws.Function;
  criticAgent: sst.aws.Function;
  notifier: sst.aws.Function;
  agentRunner: sst.aws.Function;
  bridge: sst.aws.Function;
  heartbeatHandler: sst.aws.Function;
  concurrencyMonitor: sst.aws.Function;
  maintenanceHandler: sst.aws.Function;
  mergerAgent: sst.aws.Function;
  qaAgent: sst.aws.Function;
  researcherAgent: sst.aws.Function;
  schedulerRole: aws.iam.Role;
  dlqHandler?: sst.aws.Function;
}

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
  deployerLink: sst.Linkable<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  api?: sst.aws.ApiGatewayV2;
  realtime?: sst.aws.Realtime;
  heartbeatHandler?: sst.aws.Function;
  schedulerRole?: aws.iam.Role;
  dlq?: sst.aws.Queue;
  multiplexer?: sst.aws.Function;
  agents?: AgentFunctionResources;
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
 * Common configuration for agent functions including memory tiers and timeouts.
 */
export const AGENT_CONFIG = {
  memory: {
    SMALL: '256 MB',
    MEDIUM: '512 MB',
    MEDIUM_LARGE: '1024 MB',
    LARGE: '2048 MB',
  },
  timeout: {
    SHORT: '30 seconds',
    MEDIUM: '60 seconds',
    LONG: '600 seconds',
    MAX: '900 seconds',
  },
} as const;

/** Lambda runtime architecture for all agent functions */
export const LAMBDA_ARCHITECTURE = 'arm64';

/** Node.js loader configuration for markdown files */
export const NODEJS_LOADERS = { '.md': 'text' } as const;

/** Default log retention period for Lambda functions */
export const LOG_RETENTION_PERIOD = '1 month';

/**
 * Returns the optional domain configuration for a component.
 *
 * @param component - The component to get the domain for ('api' | 'dashboard' | 'router').
 * @returns The domain configuration or undefined if not set.
 */
export function getDomainConfig(component: 'api' | 'dashboard' | 'router'):
  | {
      name: string;
      dns?: ReturnType<typeof sst.cloudflare.dns>;
      cert?: string;
    }
  | undefined {
  // Only use custom domains for production stage to avoid conflicts
  // API Gateway domain names are global within an AWS account
  // DNS records in Cloudflare must also be unique
  // Check multiple ways to get the stage for robustness
  const stage = $app.stage;

  // Only use custom domains for production stage to avoid conflicts
  if (stage !== 'prod') {
    return undefined;
  }

  const envVarMap: Record<string, string> = {
    api: 'CLAW_DOMAIN_API',
    dashboard: 'CLAW_DOMAIN_DASHBOARD',
    router: 'CLAW_DOMAIN_ROUTER',
  };
  const envVar = envVarMap[component];
  const domain = process.env[envVar];

  // Use custom domains if provided in .env
  if (!domain) return undefined;

  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const acmCertificateArn = process.env.ACM_CERTIFICATE_ARN;

  const config: {
    name: string;
    dns?: ReturnType<typeof sst.cloudflare.dns>;
    cert?: string;
  } = {
    name: domain,
  };

  if (zoneId) {
    config.dns = sst.cloudflare.dns({
      zone: zoneId,
    });
  } else if (stage === 'prod') {
    // In prod, if a domain is defined but no zone ID is present, it's an error.
    // This maintains the "Cloudflare controls it" constraint.
    console.warn(`[WARNING] Missing CLOUDFLARE_ZONE_ID for domain ${domain} in stage ${stage}.`);
  }

  if (acmCertificateArn) {
    config.cert = acmCertificateArn;
  }

  return config;
}
