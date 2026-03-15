import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { logger } from '../lib/logger';
import { runDeepHealthCheck } from '../lib/health';
import { DynamoMemory } from '../lib/memory';
import { formatErrorMessage } from '../lib/utils/error';

const memory = new DynamoMemory();

/**
 * Health probe Lambda, called by checkHealth tool after a deployment.
 * Returns 200 OK if the system and DynamoDB state are intact.
 */
export const handler: APIGatewayProxyHandlerV2 = async () => {
  try {
    const deepCheck = await runDeepHealthCheck();

    if (!deepCheck.ok) {
      throw new Error(`Deep health check failed: ${deepCheck.details}`);
    }

    // Reset recovery attempts on success
    await memory.resetRecoveryAttemptCount();

    // Save current hash as LKG if check passes
    const currentHash = process.env.GIT_HASH || 'unknown';
    if (currentHash !== 'unknown') {
      await memory.saveLKGHash(currentHash);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        gitHash: currentHash,
        message: 'System healthy (Deep Check PASSED). LKG updated.',
      }),
    };
  } catch (error) {
    logger.error('Health check failed:', error);
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'error',
        message: formatErrorMessage(error),
      }),
    };
  }
};
