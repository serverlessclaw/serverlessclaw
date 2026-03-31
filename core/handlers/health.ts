import { logger } from '../lib/logger';
import { runDeepHealthCheck } from '../lib/lifecycle/health';
import { DynamoMemory } from '../lib/memory';
import { formatErrorMessage } from '../lib/utils/error';

const memory = new DynamoMemory();

/**
 * Resets recovery attempts and saves the current Git hash as the Last Known Good (LKG).
 * Called after a successful health check to record a healthy baseline.
 */
async function updateLKGAfterHealthPass(memoryInstance: DynamoMemory): Promise<void> {
  await memoryInstance.resetRecoveryAttemptCount();
  const currentHash = process.env.GIT_HASH ?? 'unknown';
  if (currentHash !== 'unknown') {
    await memoryInstance.saveLKGHash(currentHash);
  }
}

/**
 * Health probe Lambda, called by checkHealth tool after a deployment.
 * Returns 200 OK if the system and DynamoDB state are intact.
 */
export async function handler(): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
  try {
    const deepCheck = await runDeepHealthCheck();

    if (!deepCheck.ok) {
      throw new Error(`Deep health check failed: ${deepCheck.details}`);
    }

    await updateLKGAfterHealthPass(memory);

    const currentHash = process.env.GIT_HASH ?? 'unknown';
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
}
