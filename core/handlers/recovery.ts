import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../lib/logger';
import { SSTResource } from '../lib/types/system';
import { EventType, OutboundMessageEvent } from '../lib/types/agent';
import { LockManager } from '../lib/lock/lock-manager';
import { DynamoMemory } from '../lib/memory';
import { checkCognitiveHealth, reportHealthIssue } from '../lib/lifecycle/health';
import { MEMORY_KEYS, RETENTION } from '../lib/constants';
import { emitEvent } from '../lib/utils/bus';
import { formatErrorMessage } from '../lib/utils/error';
import { getCircuitBreaker } from '../lib/safety/circuit-breaker';
import { CONFIG_DEFAULTS } from '../lib/config/config-defaults';
import { ConfigManager } from '../lib/registry/config';

const codebuild = new CodeBuildClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const typedResource = Resource as unknown as SSTResource;
const lockManager = new LockManager();
const memory = new DynamoMemory();

const RECOVERY_LOCK_ID = 'dead-mans-switch-recovery';
const RECOVERY_LOCK_OWNER = 'recovery-handler';
// TTL slightly longer than the Dead Man's Switch schedule (15 min) to guarantee one-at-a-time.
const RECOVERY_LOCK_TTL_SECONDS = CONFIG_DEFAULTS.RECOVERY_LOCK_TTL_SECONDS.code;
const MAX_RECOVERY_ATTEMPTS = CONFIG_DEFAULTS.MAX_RECOVERY_ATTEMPTS.code;
const STALE_LOCK_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes

// Default health check paths
const DEFAULT_HEALTH_PATHS = ['/health', '/', '/healthcheck'];
const HEALTH_PATHS_CONFIG_KEY = 'recovery_health_paths';

/**
 * Get health check paths from config or use defaults.
 */
async function getHealthPaths(): Promise<string[]> {
  try {
    const configPaths = await ConfigManager.getRawConfig(HEALTH_PATHS_CONFIG_KEY);
    if (configPaths && Array.isArray(configPaths) && configPaths.length > 0) {
      logger.info(`Using configured health paths: ${configPaths.join(', ')}`);
      return configPaths;
    }
  } catch (e) {
    logger.warn('Failed to fetch health paths from config, using defaults:', e);
  }
  return DEFAULT_HEALTH_PATHS;
}

/**
 * Cleans up orphaned gap locks that have expired.
 * Locks are considered orphaned if they've been expired for more than STALE_LOCK_THRESHOLD_MS.
 */
async function cleanupStaleGapLocks(): Promise<number> {
  const now = Date.now();
  const staleThreshold = Math.floor((now - STALE_LOCK_THRESHOLD_MS) / 1000);
  let deletedCount = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const queryResult = await db.send(
      new QueryCommand({
        TableName: typedResource.MemoryTable.name,
        IndexName: 'TypeTimestampIndex',
        KeyConditionExpression: '#tp = :lockType AND #ts = :zero',
        FilterExpression: 'expiresAt < :staleThreshold',
        ExpressionAttributeNames: {
          '#tp': 'type',
          '#ts': 'timestamp',
        },
        ExpressionAttributeValues: {
          ':lockType': 'GAP_LOCK',
          ':zero': 0,
          ':staleThreshold': staleThreshold,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (queryResult.Items) {
      for (const item of queryResult.Items) {
        try {
          await db.send(
            new DeleteCommand({
              TableName: typedResource.MemoryTable.name,
              Key: {
                userId: (item.userId as string) || '',
                timestamp: String((item.timestamp as string) || '0'),
              },
              ConditionExpression: 'expiresAt < :staleThreshold',
              ExpressionAttributeValues: {
                ':staleThreshold': staleThreshold,
              },
            })
          );
          deletedCount++;
        } catch (deleteError: unknown) {
          if (
            deleteError instanceof Error &&
            deleteError.name === 'ConditionalCheckFailedException'
          ) {
            logger.debug(`Skipping stale lock deletion: Lock was re-acquired`);
          } else {
            logger.warn(`Failed to delete stale gap lock:`, deleteError);
          }
        }
      }
    }

    lastEvaluatedKey = queryResult.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  if (deletedCount > 0) {
    logger.info(`Cleaned up ${deletedCount} stale gap locks`);
  }

  return deletedCount;
}

/**
 * Performs a health check on the system and triggers an emergency recovery (rollback) if unhealthy.
 *
 * @param event - Optional event payload.
 * @returns A promise that resolves when the recovery check is complete.
 */
export const handler = async (_event?: { detail: Record<string, unknown> }): Promise<void> => {
  const baseUrl = typedResource.WebhookApi.url;
  const healthPaths = await getHealthPaths();
  let lastHttpError: Error | undefined;
  let httpHealthy = false;

  for (const path of healthPaths) {
    const healthUrl = `${baseUrl}${path}`;
    logger.info(`Dead Man's Switch checking health at: ${healthUrl}`);

    try {
      const response = await fetch(healthUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        httpHealthy = true;
        break;
      }
    } catch (error) {
      lastHttpError = error instanceof Error ? error : new Error(String(error));
      logger.debug(`Health check failed for ${path}: ${lastHttpError.message}`);
    }
  }

  try {
    const healthResult = await checkCognitiveHealth();

    // Combine cognitive health with HTTP reachability for a single overall health flag
    const overallOk = healthResult.ok && httpHealthy;

    await db.send(
      new PutCommand({
        TableName: typedResource.MemoryTable.name,
        Item: {
          userId: `${MEMORY_KEYS.HEALTH_PREFIX}${Date.now()}`,
          timestamp: Date.now(),
          ok: overallOk,
          summary: healthResult.summary,
          details: healthResult.results,
          httpHealthy,
          expiresAt: Math.floor((Date.now() + RETENTION.HEALTH_DAYS * 86400000) / 1000),
        },
      })
    );

    if (httpHealthy && healthResult.ok) {
      logger.info('System is healthy (HTTP and Cognitive Checks PASSED). No action needed.');

      await cleanupStaleGapLocks();
      return;
    }

    if (!httpHealthy) {
      logger.warn(
        'HTTP health check failed - system may be unreachable. Proceeding with recovery.'
      );
    }

    if (!healthResult.ok) {
      throw new Error(healthResult.summary);
    }
  } catch (error) {
    logger.error(`System health check FAILED: ${formatErrorMessage(error)}`);

    try {
      const cb = getCircuitBreaker();
      const result = await cb.recordFailure('health');
      if (result.state === 'open') {
        logger.warn(
          `Circuit Breaker: Opened after health check failure (${result.failures.length} total in window).`
        );
      }
    } catch (cbError) {
      logger.error('Failed to record health failure in circuit breaker:', cbError);
    }
  }

  // If we reach here, the health check failed or timed out.
  // CRITICAL: Triggering Emergency Recovery
  logger.info("CRITICAL: Initiating Dead Man's Switch Recovery Flow...");

  if (process.env.STAGE === 'local' && !process.env.RECOVERY_OVERRIDE) {
    logger.info(
      '[Local Mode] System check FAILED, but skipping remote CodeBuild recovery trigger for local development.'
    );
    return;
  }

  const lockAcquired = await lockManager.acquire(RECOVERY_LOCK_ID, {
    ownerId: RECOVERY_LOCK_OWNER,
    ttlSeconds: RECOVERY_LOCK_TTL_SECONDS,
  });
  if (!lockAcquired) {
    logger.info(
      "Dead Man's Switch: Recovery already in progress (lock held). Skipping duplicate trigger."
    );
    return;
  }

  try {
    const attemptCount = await memory.incrementRecoveryAttemptCount();
    logger.info(`Recovery attempt count: ${attemptCount}/${MAX_RECOVERY_ATTEMPTS}`);

    if (attemptCount > MAX_RECOVERY_ATTEMPTS) {
      logger.error('CRITICAL: Recovery circuit-breaker triggered. Too many consecutive failures.');

      const alert: OutboundMessageEvent = {
        source: 'core.recovery',
        userId: 'ADMIN',
        traceId: `recovery-${Date.now()}`,
        taskId: `recovery-${Date.now()}`,
        initiatorId: 'DeadManSwitch',
        depth: 0,
        timestamp: Date.now(),
        message: `🚨 *CRITICAL SYSTEM FAILURE*: Automatic recovery has failed after ${attemptCount} attempts. Manual intervention required immediately.`,
        agentName: 'DeadManSwitch',
        memoryContexts: [],
        attachments: [],
        metadata: {},
        sessionId: `recovery-${Date.now()}`,
      };

      await emitEvent(
        'system.recovery',
        EventType.OUTBOUND_MESSAGE,
        alert as unknown as Record<string, unknown>
      );

      await db.send(
        new PutCommand({
          TableName: typedResource.MemoryTable.name,
          Item: {
            userId: 'DISTILLED#RECOVERY',
            timestamp: Date.now(),
            content: `Recovery halted. Circuit-breaker triggered after ${attemptCount} failed attempts. Escalated via Notifier.`,
            expiresAt: Math.floor((Date.now() + RETENTION.HEALTH_DAYS * 86400000) / 1000),
          },
        })
      );
      logger.info('Recovery circuit-breaker handled, skipping rollback.');
      return;
    }

    const lkgHash = await memory.getLatestLKGHash();
    if (!lkgHash) {
      logger.warn('No LKG hash found in memory. Falling back to generic HEAD revert.');
    } else if (!/^[a-f0-9]{7,40}$/i.test(lkgHash) && lkgHash !== 'dev') {
      logger.error(
        `Invalid LKG hash detected: ${lkgHash}. Aborting recovery to prevent possible corruption.`
      );
      await db.send(
        new PutCommand({
          TableName: typedResource.MemoryTable.name,
          Item: {
            userId: 'DISTILLED#RECOVERY',
            timestamp: Date.now(),
            content: `Recovery ABORTED: Invalid LKG hash "${lkgHash}" detected. Manual intervention required.`,
            expiresAt: Math.floor((Date.now() + RETENTION.HEALTH_DAYS * 86400000) / 1000),
          },
        })
      );
      return;
    }

    if (lkgHash === 'dev') {
      logger.info(
        'LKG hash is "dev" (Development Mode). Proceeding with generic recovery fallback.'
      );
    }

    logger.info(
      `Triggering CodeBuild Deployer for emergency recovery to LKG: ${lkgHash ?? 'HEAD^'}...`
    );
    const command = new StartBuildCommand({
      projectName: typedResource.Deployer.name,
      environmentVariablesOverride: [
        { name: 'EMERGENCY_ROLLBACK', value: 'true' },
        { name: 'LKG_HASH', value: lkgHash ?? '' },
      ],
    });

    await codebuild.send(command);

    await db.send(
      new PutCommand({
        TableName: typedResource.MemoryTable.name,
        Item: {
          userId: 'DISTILLED#RECOVERY',
          timestamp: Date.now(),
          content: `Dead Man's Switch detected unhealthy system and triggered attempt #${attemptCount} for rollback to ${lkgHash ?? 'previous state'}.`,
          expiresAt: Math.floor((Date.now() + RETENTION.HEALTH_DAYS * 86400000) / 1000),
        },
      })
    );
  } catch (recoveryError) {
    logger.error("FATAL: Dead Man's Switch recovery flow failed!", recoveryError);
    await reportHealthIssue({
      component: 'DeadMansSwitch',
      issue: `Recovery flow failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
      severity: 'critical',
      userId: 'SYSTEM',
      traceId: 'recovery',
      context: { error: recoveryError },
    });
    throw recoveryError;
  } finally {
    await lockManager.release(RECOVERY_LOCK_ID, RECOVERY_LOCK_OWNER);
  }
};
