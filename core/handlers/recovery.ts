import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../lib/logger';
import { SSTResource } from '../lib/types/system';
import { EventType, OutboundMessageEvent } from '../lib/types/agent';
import { DynamoLockManager } from '../lib/lock';
import { DynamoMemory } from '../lib/memory';
import { checkCognitiveHealth } from '../lib/lifecycle/health';
import { MEMORY_KEYS, RETENTION } from '../lib/constants';
import { emitEvent } from '../lib/utils/bus';
import { formatErrorMessage } from '../lib/utils/error';
import { getCircuitBreaker } from '../lib/safety/circuit-breaker';

const codebuild = new CodeBuildClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const typedResource = Resource as unknown as SSTResource;
const lockManager = new DynamoLockManager();
const memory = new DynamoMemory();

const RECOVERY_LOCK_ID = 'dead-mans-switch-recovery';
// TTL slightly longer than the Dead Man's Switch schedule (15 min) to guarantee one-at-a-time.
const RECOVERY_LOCK_TTL_SECONDS = 20 * 60;
const MAX_RECOVERY_ATTEMPTS = 2;

/**
 * Performs a health check on the system and triggers an emergency recovery (rollback) if unhealthy.
 *
 * @param event - Optional event payload.
 * @returns A promise that resolves when the recovery check is complete.
 */
export const handler = async (_event?: { detail: Record<string, unknown> }): Promise<void> => {
  const healthUrl = `${typedResource.WebhookApi.url}/health`;
  logger.info(`Dead Man's Switch checking health at: ${healthUrl}`);

  try {
    const healthResult = await checkCognitiveHealth();

    // Persist health result for historical tracking
    await db.send(
      new PutCommand({
        TableName: typedResource.MemoryTable.name,
        Item: {
          userId: `${MEMORY_KEYS.HEALTH_PREFIX}${Date.now()}`,
          timestamp: Date.now(),
          ok: healthResult.ok,
          summary: healthResult.summary,
          details: healthResult.results,
          expiresAt: Math.floor((Date.now() + RETENTION.HEALTH_DAYS * 86400000) / 1000),
        },
      })
    );

    if (!healthResult.ok) {
      throw new Error(healthResult.summary);
    }

    logger.info('System is healthy (Cognitive Check PASSED). No action needed.');
    return;
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

  const lockAcquired = await lockManager.acquire(
    RECOVERY_LOCK_ID,
    'recovery-handler',
    RECOVERY_LOCK_TTL_SECONDS
  );
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
        userId: 'ADMIN',
        traceId: `recovery-${Date.now()}`,
        taskId: `recovery-${Date.now()}`,
        initiatorId: 'DeadManSwitch',
        depth: 0,
        message: `🚨 *CRITICAL SYSTEM FAILURE*: Automatic recovery has failed after ${attemptCount} attempts. Manual intervention required immediately. Health Check: ${healthUrl}`,
        agentName: 'DeadManSwitch',
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
          },
        })
      );
      logger.info('Recovery circuit-breaker handled, skipping rollback.');
      return;
    }

    const lkgHash = await memory.getLatestLKGHash();
    if (!lkgHash) {
      logger.warn('No LKG hash found in memory. Falling back to generic HEAD revert.');
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
        },
      })
    );

    logger.info('Emergency recovery initiated successfully.');
  } catch (recoveryError) {
    logger.error("FATAL: Dead Man's Switch recovery flow failed!", recoveryError);
  } finally {
    await lockManager.release(RECOVERY_LOCK_ID, 'recovery-handler');
  }
};
