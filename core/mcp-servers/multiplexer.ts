import {
  type Handler,
  type Context,
  type APIGatewayProxyEvent,
  type APIGatewayProxyResult,
} from 'aws-lambda';
import { stdioServerAdapter } from '@aws/run-mcp-servers-with-aws-lambda';
import { type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '../lib/logger';
import { MCP_SERVER_REGISTRY } from './registry';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

/**
 * Resolves the absolute path to the `npx` binary.
 */
function resolveNpxPath(): string {
  try {
    return execSync('which npx', { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    const commonPaths = [
      '/var/lang/bin/npx', // AWS Lambda
      '/opt/homebrew/bin/npx',
      '/usr/local/bin/npx',
      '/usr/bin/npx',
    ];
    for (const p of commonPaths) {
      if (existsSync(p)) return p;
    }
    return 'npx';
  }
}

let _resolvedNpxPath: string | undefined;

function getResolvedNpxPath(): string {
  if (!_resolvedNpxPath) {
    _resolvedNpxPath = resolveNpxPath();
  }
  return _resolvedNpxPath;
}

/**
 * Unified MCP Multiplexer Handler.
 * Routes JSON-RPC requests to the appropriate MCP server based on path or headers.
 */
export const handler: Handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();

  // 1. Identify which server is requested
  // Path: /mcp/git -> serverName = 'git'
  // Header: x-mcp-server: git
  const pathParts = event.path.split('/').filter(Boolean);
  const serverName = (
    event.headers['x-mcp-server'] ||
    pathParts[pathParts.length - 1] ||
    'unknown'
  ).toLowerCase();

  logger.info(`[MCP-MULTIPLEXER] Routing request to: ${serverName}`, {
    requestId: context.awsRequestId,
    path: event.path,
    headers: event.headers,
  });

  const baseConfig = MCP_SERVER_REGISTRY[serverName];

  if (!baseConfig) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Not Found',
        message: `MCP Server '${serverName}' not found in registry.`,
        availableServers: Object.keys(MCP_SERVER_REGISTRY),
      }),
    };
  }

  // 2. Prepare resolved parameters
  const resolvedParams: StdioServerParameters =
    baseConfig.command === 'npx'
      ? {
          ...baseConfig,
          command: getResolvedNpxPath(),
          env: {
            ...baseConfig.env,
            PATH: process.env.PATH ?? '/var/lang/bin:/usr/local/bin:/usr/bin',
            MCP_SERVER_NAME: serverName, // Pass to sub-process for logging/identification
          },
        }
      : baseConfig;

  try {
    // 3. Parse JSON-RPC request
    const rpcRequest = JSON.parse(event.body || '{}');

    // 4. Delegate to the MCP-Lambda adapter
    const result = await stdioServerAdapter(resolvedParams, rpcRequest, context);

    const duration = Date.now() - startTime;
    logger.info(`[MCP-MULTIPLEXER] ${serverName} completed`, {
      requestId: context.awsRequestId,
      duration,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`[MCP-MULTIPLEXER] ${serverName} failed`, {
      requestId: context.awsRequestId,
      duration,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        server: serverName,
      }),
    };
  }
};
