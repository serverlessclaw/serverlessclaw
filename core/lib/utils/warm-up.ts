import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { logger } from '../logger';

const lambda = new LambdaClient({});

/**
 * Warms up critical agents to reduce cold start latency during active sessions.
 * Sends a non-blocking 'WARMUP' signal to the specified Lambda functions.
 * 
 * @param functionArns - Array of Lambda function ARNs or names to warm up.
 */
export async function warmUpAgents(functionArns: string[]): Promise<void> {
  if (!functionArns || functionArns.length === 0) {
    return;
  }

  logger.info(`[WARMUP] Triggering warm-up for ${functionArns.length} agents...`);

  // We use Promise.allSettled and Fire-and-Forget (Event invocation)
  // to ensure this doesn't block the main request flow.
  const warmupPromises = functionArns.map((arn) => {
    const command = new InvokeCommand({
      FunctionName: arn,
      InvocationType: 'Event', // Asynchronous execution
      Payload: Buffer.from(JSON.stringify({ type: 'WARMUP', source: 'webhook.warmup' })),
    });

    return lambda.send(command).catch((err) => {
      logger.error(`[WARMUP] Failed to warm up agent ${arn}:`, err);
    });
  });

  // We don't await the individual results here to keep the webhook fast
  Promise.allSettled(warmupPromises).then((results) => {
    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    logger.info(`[WARMUP] Warm-up signals emitted. Success: ${successCount}/${functionArns.length}`);
  });
}
