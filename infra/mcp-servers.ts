import {
  SharedContext,
  getValidSecrets,
  LAMBDA_ARCHITECTURE,
  NODEJS_LOADERS,
  LOG_RETENTION_PERIOD,
  AGENT_CONFIG,
} from './shared';

/**
 * Deploys Granular MCP Multiplexer Lambda functions.
 * Splits tools by permission requirements to enforce least privilege.
 */

export interface MCPServerResources {
  multiplexer: sst.aws.Function; // Primary/General multiplexer
  browserMultiplexer: sst.aws.Function;
  devOpsMultiplexer: sst.aws.Function;
}

/**
 * Creates the Granular MCP Multiplexer Lambda functions.
 *
 * @param ctx - The shared infrastructure context.
 * @returns The created MCP multiplexer functions.
 */
export function createMCPServers(ctx: SharedContext): MCPServerResources {
  const { memoryTable, configTable, secrets, stagingBucket } = ctx;
  const validSecrets = getValidSecrets(secrets);

  const baseEnv = {
    PATH: '/var/lang/bin:/usr/local/bin:/usr/bin:/bin:/opt/bin',
    HOME: '/tmp',
    NPM_CONFIG_CACHE: '/tmp/npm-cache',
    XDG_CACHE_HOME: '/tmp/mcp-cache',
    TRACE_SUMMARIES_ENABLED: 'true',
  };

  const commonProps = {
    handler: 'core/mcp-servers/multiplexer.handler',
    dev: false as const,
    architecture: LAMBDA_ARCHITECTURE as 'arm64' | 'x86_64',
    nodejs: { loader: NODEJS_LOADERS },
    logging: { retention: LOG_RETENTION_PERIOD as any },
    url: { authorization: 'iam' as const },
  };

  // 1. General Multiplexer (git, filesystem, fetch, google-search, ast)
  // Low privilege: only needs basic links and CloudWatch metrics.
  const generalMultiplexer = new sst.aws.Function('GeneralMCPMultiplexer', {
    ...commonProps,
    link: [memoryTable, configTable, ...validSecrets],
    permissions: [
      {
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      },
    ],
    memory: AGENT_CONFIG.memory.MEDIUM, // 512 MB
    timeout: AGENT_CONFIG.timeout.MEDIUM, // 60s
    environment: baseEnv,
  });

  // 2. Browser Multiplexer (puppeteer)
  // High memory/timeout for headless browser execution.
  const browserMultiplexer = new sst.aws.Function('BrowserMCPMultiplexer', {
    ...commonProps,
    link: [memoryTable, configTable, ...validSecrets],
    permissions: [
      {
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      },
    ],
    memory: AGENT_CONFIG.memory.MEDIUM_LARGE, // 1024 MB
    timeout: AGENT_CONFIG.timeout.LONG, // 600s
    environment: {
      ...baseEnv,
      PUPPETEER_EXECUTABLE_PATH: '/opt/chromium',
    },
  });

  // 3. DevOps Multiplexer (aws, aws-s3)
  // Higher privilege: access to CodeBuild and S3.
  const devOpsMultiplexer = new sst.aws.Function('DevOpsMCPMultiplexer', {
    ...commonProps,
    link: [memoryTable, configTable, stagingBucket, ...validSecrets],
    permissions: [
      {
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      },
      {
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:DeleteObject'],
        resources: [stagingBucket.arn, $util.interpolate`${stagingBucket.arn}/*`],
      },
      {
        actions: [
          'lambda:GetFunction',
          'lambda:ListFunctions',
          'ec2:DescribeInstances',
          'iam:ListRoles',
          'codebuild:StartBuild',
          'codebuild:BatchGetBuilds',
        ],
        resources: ['*'],
      },
    ],
    memory: AGENT_CONFIG.memory.MEDIUM, // 512 MB
    timeout: AGENT_CONFIG.timeout.MEDIUM, // 60s
    environment: baseEnv,
  });

  return {
    multiplexer: generalMultiplexer,
    browserMultiplexer,
    devOpsMultiplexer,
  };
}
