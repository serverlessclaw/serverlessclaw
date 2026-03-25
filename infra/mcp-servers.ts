import { SharedContext } from './shared';

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
    memory: 128 as const,
    timeout: 30,
    description: 'Git operations via @cyanheads/git-mcp-server',
    warmSchedule: 'rate(5 minutes)', // Critical - keep warm
  },
  filesystem: {
    handler: 'core/mcp-servers/filesystem.handler',
    memory: 128 as const,
    timeout: 30,
    description: 'Filesystem operations via @modelcontextprotocol/server-filesystem',
    warmSchedule: 'rate(5 minutes)', // Critical - keep warm
  },
  'google-search': {
    handler: 'core/mcp-servers/google-search.handler',
    memory: 256 as const,
    timeout: 60,
    description: 'Google search via @mcp-server/google-search-mcp',
    warmSchedule: 'rate(15 minutes)', // Less critical
  },
  puppeteer: {
    handler: 'core/mcp-servers/puppeteer.handler',
    memory: 512 as const,
    timeout: 120,
    description: 'Browser automation via @kirkdeam/puppeteer-mcp-server',
    warmSchedule: 'rate(30 minutes)', // Rarely used
  },
  fetch: {
    handler: 'core/mcp-servers/fetch.handler',
    memory: 128 as const,
    timeout: 60,
    description: 'HTTP fetch operations via mcp-fetch-server',
    warmSchedule: 'rate(15 minutes)',
  },
  aws: {
    handler: 'core/mcp-servers/aws.handler',
    memory: 256 as const,
    timeout: 60,
    description: 'AWS operations via mcp-aws-devops-server',
    warmSchedule: 'rate(15 minutes)',
  },
  'aws-s3': {
    handler: 'core/mcp-servers/aws-s3.handler',
    memory: 256 as const,
    timeout: 60,
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
  const baseLink = [memoryTable, configTable, ...secrets];

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
      architecture: 'arm64',
      nodejs: { loader: { '.md': 'text' } },
      memory: config.memory,
      timeout: config.timeout,
      logging: {
        retention: '1 month',
      },
      environment: {
        MCP_SERVER_NAME: name,
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
    architecture: 'arm64',
    memory: 128,
    timeout: 60,
    logging: {
      retention: '1 month',
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
    scheduleExpression: 'rate(5 minutes)',
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
    scheduleExpression: 'rate(15 minutes)',
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
    scheduleExpression: 'rate(30 minutes)',
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
