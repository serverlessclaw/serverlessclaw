import {
  type Handler,
  type Context,
  type APIGatewayProxyEvent,
  type APIGatewayProxyResult,
} from 'aws-lambda';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { stdioServerAdapter } from '@aws/run-mcp-servers-with-aws-lambda';
import { type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '../lib/logger';

/**
 * Resolves the absolute path to the `npx` binary.
 * The MCP SDK uses `spawn` with `shell: false`, which requires an absolute path.
 * Falls back to common installation paths if `which` fails.
 */
function resolveNpxPath(): string {
  try {
    return execSync('which npx', { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    const commonPaths = [
      '/var/lang/bin/npx', // AWS Lambda
      '/opt/homebrew/bin/npx', // macOS ARM (Homebrew)
      '/usr/local/bin/npx', // macOS Intel (Homebrew)
      '/usr/bin/npx', // Linux
    ];
    for (const p of commonPaths) {
      if (existsSync(p)) return p;
    }
    return 'npx';
  }
}

/** Cached resolved npx path to avoid repeated resolution */
let _resolvedNpxPath: string | undefined;

function getResolvedNpxPath(): string {
  if (!_resolvedNpxPath) {
    _resolvedNpxPath = resolveNpxPath();
  }
  return _resolvedNpxPath;
}

/**
 * Creates a Lambda handler for an MCP server using the AWS Labs MCP Lambda library.
 * Wraps stdio-based MCP servers to run in a serverless environment.
 *
 * @param serverParams - The stdio server parameters (command, args, env) for the MCP server.
 * @returns A Lambda handler function that processes JSON-RPC requests via API Gateway.
 */
export function createMCPServerHandler(serverParams: StdioServerParameters): Handler {
  // Resolve the full npx path once at handler creation time to avoid ENOENT errors
  // when the MCP SDK calls spawn() with shell: false
  const resolvedParams: StdioServerParameters =
    serverParams.command === 'npx'
      ? { ...serverParams, command: getResolvedNpxPath() }
      : serverParams;

  return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
    const serverName = process.env.MCP_SERVER_NAME ?? 'unknown';
    const startTime = Date.now();

    logger.info(`MCP Server ${serverName} invoked`, {
      requestId: context.awsRequestId,
      path: event.path,
      httpMethod: event.httpMethod,
    });

    try {
      // Parse the JSON-RPC request from the API Gateway body
      const rpcRequest = JSON.parse(event.body || '{}');

      // Use the stdioServerAdapter to handle the request
      const result = await stdioServerAdapter(resolvedParams, rpcRequest, context);

      const duration = Date.now() - startTime;
      logger.info(`MCP Server ${serverName} completed`, {
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
      logger.error(`MCP Server ${serverName} failed`, {
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
        }),
      };
    }
  };
}

/**
 * Health check handler for MCP servers.
 * Can be invoked with a simple GET request to verify the server is responsive.
 */
export function createHealthCheckHandler(serverParams: StdioServerParameters): Handler {
  return async (
    _event: APIGatewayProxyEvent,
    _context: Context
  ): Promise<APIGatewayProxyResult> => {
    const serverName = process.env.MCP_SERVER_NAME ?? 'unknown';

    // Simple health check - just verify we can create the handler
    try {
      createMCPServerHandler(serverParams);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'healthy',
          server: serverName,
          timestamp: Date.now(),
        }),
      };
    } catch (error) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'unhealthy',
          server: serverName,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        }),
      };
    }
  };
}
