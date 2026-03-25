import type { Handler, Context } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { logger } from '../lib/logger';

const lambdaClient = new LambdaClient({});

interface WarmupEvent {
  servers?: string[];
}

/**
 * MCP Warmup Handler
 * Invokes MCP server Lambdas to keep them warm and reduce cold start latency.
 * Called by EventBridge Scheduler on a regular basis.
 */
export const handler: Handler = async (event: WarmupEvent, _context: Context) => {
  const serverArns: Record<string, string> = JSON.parse(process.env.MCP_SERVER_ARNS ?? '{}');
  const serversToWarm = event.servers ?? Object.keys(serverArns);

  logger.info('MCP Warmup started', {
    serversToWarm,
    totalServers: Object.keys(serverArns).length,
  });

  const results = await Promise.allSettled(
    serversToWarm.map(async (serverName) => {
      const arn = serverArns[serverName];
      if (!arn) {
        logger.warn(`MCP server ${serverName} not found in ARN map`);
        return { server: serverName, status: 'not_found' };
      }

      try {
        // Invoke the Lambda with a health check payload
        await lambdaClient.send(
          new InvokeCommand({
            FunctionName: arn,
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify({
              httpMethod: 'GET',
              path: '/health',
              headers: {},
              body: null,
            }),
          })
        );

        logger.info(`MCP server ${serverName} warmed successfully`);
        return { server: serverName, status: 'success' };
      } catch (error) {
        logger.error(`Failed to warm MCP server ${serverName}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        return { server: serverName, status: 'failed', error: String(error) };
      }
    })
  );

  const summary = {
    total: serversToWarm.length,
    success: results.filter((r) => r.status === 'fulfilled' && r.value.status === 'success').length,
    failed: results.filter(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'failed')
    ).length,
    notFound: results.filter((r) => r.status === 'fulfilled' && r.value.status === 'not_found')
      .length,
  };

  logger.info('MCP Warmup completed', summary);

  return {
    statusCode: 200,
    body: JSON.stringify(summary),
  };
};
