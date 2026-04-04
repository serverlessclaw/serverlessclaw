import {
  SharedContext,
  getValidSecrets,
  LAMBDA_ARCHITECTURE,
  NODEJS_LOADERS,
  LOG_RETENTION_PERIOD,
  AGENT_CONFIG,
} from './shared';

/**
 * Deploys the Unified MCP Multiplexer Lambda function.
 * This single Lambda handles all MCP server requests, routing them
 * to the appropriate virtual server on-demand.
 */

export interface MCPServerResources {
  multiplexer: sst.aws.Function;
}

/**
 * Creates the Unified MCP Multiplexer Lambda function.
 *
 * @param ctx - The shared infrastructure context.
 * @returns The created MCP multiplexer function.
 */
export function createMCPServers(ctx: SharedContext): MCPServerResources {
  const { memoryTable, configTable, secrets, stagingBucket } = ctx;
  const liveInLocalOnly = $app.stage === 'local' ? undefined : false;

  // Unified permissions for ALL MCP tools
  // This role has the union of all necessary permissions for git, aws, s3, etc.
  const unifiedPermissions = [
    {
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    },
    {
      // S3 operations for aws-s3 and general media staging
      actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:DeleteObject'],
      resources: [stagingBucket.arn, `${stagingBucket.arn}/*`],
    },
    {
      // AWS DevOps operations
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
  ];

  // Base links for the multiplexer
  const baseLink = [memoryTable, configTable, stagingBucket, ...getValidSecrets(secrets)];

  const multiplexer = new sst.aws.Function('MCPServerMultiplexer', {
    handler: 'core/mcp-servers/multiplexer.handler',
    dev: liveInLocalOnly,
    link: baseLink,
    permissions: unifiedPermissions,
    architecture: LAMBDA_ARCHITECTURE,
    nodejs: { loader: NODEJS_LOADERS },
    // Provisioned for the "worst case" (Puppeteer/AST) to ensure all tools run smoothly
    memory: AGENT_CONFIG.memory.MEDIUM_LARGE, // 1024 MB
    timeout: AGENT_CONFIG.timeout.LONG, // 600 seconds
    logging: {
      retention: LOG_RETENTION_PERIOD,
    },
    environment: {
      // PATH is critical for finding node/npx in the Lambda environment
      PATH: '/var/lang/bin:/usr/local/bin:/usr/bin:/bin:/opt/bin',
      // Ensure HOME is writable for git/npx config
      HOME: '/tmp',
      NPM_CONFIG_CACHE: '/tmp/npm-cache',
      XDG_CACHE_HOME: '/tmp/mcp-cache',
    },
    // Enable function URL for direct IAM-authenticated access
    url: {
      cors: {
        allowOrigins: ['*'],
        allowMethods: ['POST'],
        allowHeaders: ['Content-Type', 'Authorization', 'x-mcp-server'],
      },
    },
  });

  return {
    multiplexer,
  };
}
