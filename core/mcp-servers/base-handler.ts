import type { Handler, Context, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  APIGatewayProxyEventHandler,
  StdioServerAdapterRequestHandler,
  type StdioServerParameters,
} from '@aws/run-mcp-servers-with-aws-lambda';
import { logger } from '../lib/logger';

/**
 * Creates a Lambda handler for an MCP server using the AWS Labs MCP Lambda library.
 *
 * @param serverParams - The stdio server parameters for the MCP server
 * @returns A Lambda handler function
 */
export function createMCPServerHandler(serverParams: StdioServerParameters): Handler {
  const requestHandler = new APIGatewayProxyEventHandler(
    new StdioServerAdapterRequestHandler(serverParams)
  );

  return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
    const serverName = process.env.MCP_SERVER_NAME ?? 'unknown';
    const startTime = Date.now();

    logger.info(`MCP Server ${serverName} invoked`, {
      requestId: context.awsRequestId,
      path: event.path,
      httpMethod: event.httpMethod,
    });

    try {
      const result = await requestHandler.handle(event, context);

      const duration = Date.now() - startTime;
      logger.info(`MCP Server ${serverName} completed`, {
        requestId: context.awsRequestId,
        duration,
        statusCode: result.statusCode,
      });

      return result;
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
