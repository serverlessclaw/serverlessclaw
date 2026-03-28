import { SharedContext, getValidSecrets } from './shared';

/** Lambda runtime architecture for all MCP server functions */
const LAMBDA_ARCHITECTURE = 'arm64';

/** Node.js loader configuration for markdown files */
const NODEJS_LOADERS = { '.md': 'text' } as const;

/** Default log retention period for Lambda functions */
const LOG_RETENTION_PERIOD = '1 month';

/** Default memory allocation for warmup handler */
const WARMUP_HANDLER_MEMORY = '128 MB';

/** Default timeout for warmup handler */
const WARMUP_HANDLER_TIMEOUT = '60 seconds';

/**
 * Deploys MCP (Model Context Protocol) servers as separate Lambda functions.
 * Each MCP server runs independently for fault isolation and independent scaling.
 *
 * Uses @aws/run-mcp-servers-with-aws-lambda to wrap stdio-based MCP servers.
 */

// MCP Server configurations
const MCP_SERVER_CONFIGS = {
  git: {
    handler: 'core/mcp-servers/git.handler',
    memory: '128 MB' as const,
    timeout: '30 seconds' as const,
    description: 'Git operations via @cyanheads/git-mcp-server',
    warmSchedule: 'rate(5 minutes)', // Critical - keep warm
  },
  filesystem: {
    handler: 'core/mcp-servers/filesystem.handler',
    memory: '128 MB' as const,
    timeout: '30 seconds' as const,
    description: 'Filesystem operations via @modelcontextprotocol/server-filesystem',
    warmSchedule: 'rate(5 minutes)', // Critical - keep warm
  },
  'google-search': {
    handler: 'core/mcp-servers/google-search.handler',
    memory: '256 MB' as const,
    timeout: '60 seconds' as const,
    description: 'Google search via @mcp-server/google-search-mcp',
    warmSchedule: 'rate(15 minutes)', // Less critical
  },
  puppeteer: {
    handler: 'core/mcp-servers/puppeteer.handler',
    memory: '512 MB' as const,
    timeout: '120 seconds' as const,
    description: 'Browser automation via @kirkdeam/puppeteer-mcp-server',
    warmSchedule: 'rate(30 minutes)', // Rarely used
  },
  fetch: {
    handler: 'core/mcp-servers/fetch.handler',
    memory: '128 MB' as const,
    timeout: '60 seconds' as const,
    description: 'HTTP fetch operations via mcp-fetch-server',
    warmSchedule: 'rate(15 minutes)',
  },
  aws: {
    handler: 'core/mcp-servers/aws.handler',
    memory: '256 MB' as const,
    timeout: '60 seconds' as const,
    description: 'AWS operations via mcp-aws-devops-server',
    warmSchedule: 'rate(15 minutes)',
  },
  'aws-s3': {
    handler: 'core/mcp-servers/aws-s3.handler',
    memory: '256 MB' as const,
    timeout: '60 seconds' as const,
    description: 'S3 operations via @geunoh/s3-mcp-server',
    warmSchedule: 'rate(15 minutes)',
  },
} as const;

type MCPServerName = keyof typeof MCP_SERVER_CONFIGS;

export interface MCPServerResources {
  servers: Record<MCPServerName, sst.aws.Function>;
  warmupHandler: sst.aws.Function;
  schedulerRole: aws.iam.Role;
}

/**
 * Creates all MCP server Lambda functions and warming infrastructure.
 *
 * @param ctx - The shared infrastructure context containing tables, buckets, and secrets.
 * @returns The created MCP server functions and associated warmup resources.
 */
export function createMCPServers(ctx: SharedContext): MCPServerResources {
  const { memoryTable, configTable, secrets } = ctx;
  const liveInLocalOnly = $app.stage === 'local' ? undefined : false;

  // Base permissions for MCP servers
  const basePermissions = [
    {
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    },
  ];

  // Base links for MCP servers (minimal - they don't need full agent access)
  const baseLink = [memoryTable, configTable, ...getValidSecrets(secrets)];

  // Create each MCP server as a separate Lambda
  const servers = {} as Record<MCPServerName, sst.aws.Function>;

  for (const [name, config] of Object.entries(MCP_SERVER_CONFIGS)) {
    const serverName = name as MCPServerName;
    const pascalName = name
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');

    servers[serverName] = new sst.aws.Function(`MCP${pascalName}Server`, {
      handler: config.handler,
      dev: liveInLocalOnly,
      link: baseLink,
      permissions: basePermissions,
      architecture: LAMBDA_ARCHITECTURE,
      nodejs: { loader: NODEJS_LOADERS },
      memory: config.memory,
      timeout: config.timeout,
      logging: {
        retention: LOG_RETENTION_PERIOD,
      },
      environment: {
        MCP_SERVER_NAME: name,
        PATH: process.env.PATH ?? '/var/lang/bin:/usr/local/bin:/usr/bin',
      },
      // Enable function URL for direct IAM-authenticated access
      url: {
        cors: {
          allowOrigins: ['*'],
          allowMethods: ['POST'],
          allowHeaders: ['Content-Type', 'Authorization'],
        },
      },
    });
  }

  // Create warmup handler that invokes all MCP servers
  const warmupHandler = new sst.aws.Function('MCPWarmupHandler', {
    handler: 'core/handlers/mcp-warmup.handler',
    dev: liveInLocalOnly,
    link: [],
    permissions: [
      {
        actions: ['lambda:InvokeFunction'],
        resources: Object.values(servers).map((s) => s.arn),
      },
    ],
    architecture: LAMBDA_ARCHITECTURE,
    memory: WARMUP_HANDLER_MEMORY,
    timeout: WARMUP_HANDLER_TIMEOUT,
    logging: {
      retention: LOG_RETENTION_PERIOD,
    },
    environment: {
      MCP_SERVER_ARNS: $util.jsonStringify(
        Object.fromEntries(Object.entries(servers).map(([name, fn]) => [name, fn.arn]))
      ),
    },
  });

  // Create IAM role for EventBridge Scheduler
  const schedulerRole = new aws.iam.Role('MCPWarmupSchedulerRole', {
    assumeRolePolicy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: { Service: 'scheduler.amazonaws.com' },
        },
      ],
    }),
  });

  new aws.iam.RolePolicy('MCPWarmupSchedulerPolicy', {
    role: schedulerRole.name,
    policy: $util.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'lambda:InvokeFunction',
          Effect: 'Allow',
          Resource: [warmupHandler.arn],
        },
      ],
    }),
  });

  // Create EventBridge schedules for warming
  // Critical servers (git, filesystem) - warm every 5 minutes
  new aws.scheduler.Schedule('MCPWarmupCritical', {
    name: `${$app.name}-${$app.stage}-MCPWarmupCritical`,
    description: 'Warm critical MCP servers (git, filesystem) every 5 min to prevent cold starts',
    scheduleExpression: 'rate(5 minutes)',
    state: 'DISABLED',
    flexibleTimeWindow: { mode: 'OFF' },
    target: {
      arn: warmupHandler.arn,
      roleArn: schedulerRole.arn,
      input: $util.jsonStringify({
        servers: ['git', 'filesystem'],
      }),
    },
  });

  // Standard servers - warm every 15 minutes
  new aws.scheduler.Schedule('MCPWarmupStandard', {
    name: `${$app.name}-${$app.stage}-MCPWarmupStandard`,
    description: 'Warm standard MCP servers (google-search, fetch, aws, aws-s3) every 15 min',
    scheduleExpression: 'rate(15 minutes)',
    state: 'DISABLED',
    flexibleTimeWindow: { mode: 'OFF' },
    target: {
      arn: warmupHandler.arn,
      roleArn: schedulerRole.arn,
      input: $util.jsonStringify({
        servers: ['google-search', 'fetch', 'aws', 'aws-s3'],
      }),
    },
  });

  // Low-priority servers - warm every 30 minutes
  new aws.scheduler.Schedule('MCPWarmupLowPriority', {
    name: `${$app.name}-${$app.stage}-MCPWarmupLowPriority`,
    description: 'Warm low-priority MCP servers (puppeteer) every 30 min',
    scheduleExpression: 'rate(30 minutes)',
    state: 'DISABLED',
    flexibleTimeWindow: { mode: 'OFF' },
    target: {
      arn: warmupHandler.arn,
      roleArn: schedulerRole.arn,
      input: $util.jsonStringify({
        servers: ['puppeteer'],
      }),
    },
  });

  return {
    servers,
    warmupHandler,
    schedulerRole,
  };
}
