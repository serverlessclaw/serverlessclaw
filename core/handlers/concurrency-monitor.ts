/**
 * Lambda Concurrency Monitor
 *
 * Monitors Lambda concurrent execution usage and alerts when approaching limits.
 * Also detects and force-releases stuck session locks.
 *
 * NOTE: Requires @aws-sdk/client-lambda to be installed for actual monitoring.
 */

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import type { SSTResource } from '../lib/types/system';
import { logger } from '../lib/logger';
import { emitEvent } from '../lib/utils/bus';
import { EventType } from '../lib/types/agent';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const typedResource = Resource as unknown as SSTResource;

const ALERT_THRESHOLD_PERCENT = 80;
const CONCURRENCY_KEY = 'SYSTEM#LAMBDA_CONCURRENCY';
const CONCURRENCY_METRICS_TTL_SECONDS = 3600; // 1 hour retention

// Force unlock configuration
const LOCK_PREFIX = 'LOCK#SESSION#';
const STUCK_LOCK_THRESHOLD_SECONDS = 300; // 5 minutes - same as LOCK_TTL_SECONDS
const FORCE_UNLOCK_ENABLED = process.env.FORCE_UNLOCK_ENABLED === 'true';

interface LambdaAccountSettings {
  AccountUsage?: {
    TotalCodeSize: number;
    FunctionCount: number;
  };
  AccountSnapshots?: Array<{
    UnreservedConcurrentExecutions?: {
      Remaining?: number;
      Capacity?: number;
    };
  }>;
}

async function _forceUnlockStuckSessions(): Promise<number> {
  if (!FORCE_UNLOCK_ENABLED) {
    logger.debug('Force unlock disabled, skipping stuck session check');
    return 0;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  let unlockedCount = 0;

  try {
    const result = await db.send(
      new ScanCommand({
        TableName: typedResource.MemoryTable.name,
        FilterExpression: 'begins_with(userId, :lockPrefix) AND expiresAt < :now',
        ExpressionAttributeValues: {
          ':lockPrefix': { S: LOCK_PREFIX },
          ':now': { N: nowSec.toString() },
        },
        ProjectionExpression: 'userId, expiresAt, ownerId',
      })
    );

    const items = result.Items || [];
    logger.info(`[FORCE_UNLOCK] Found ${items.length} expired locks to check`);

    for (const item of items) {
      const userId = item.userId.S as string;
      const expiresAt = parseInt(item.expiresAt.N as string, 10);
      const ownerId = item.ownerId?.S as string | undefined;

      if (expiresAt < nowSec - STUCK_LOCK_THRESHOLD_SECONDS) {
        logger.warn(
          `[FORCE_UNLOCK] Force releasing stuck lock: ${userId} (owner: ${ownerId}, expired at ${expiresAt})`
        );

        try {
          await db.send(
            new UpdateCommand({
              TableName: typedResource.MemoryTable.name,
              Key: { userId, timestamp: 0 },
              UpdateExpression: 'SET ownerId = :null, expiresAt = :null, lockType = :released',
              ExpressionAttributeValues: {
                ':null': null,
                ':released': 'FORCE_RELEASED',
              },
            })
          );
          unlockedCount++;

          await emitEvent('system.monitor', EventType.OUTBOUND_MESSAGE, {
            userId: 'ADMIN',
            message: `🔓 *Force Unlock*\n\nReleased stuck session lock: ${userId.replace(LOCK_PREFIX, '')}\nPrevious owner: ${ownerId}`,
            agentName: 'ConcurrencyMonitor',
          });
        } catch (updateError) {
          logger.error(`[FORCE_UNLOCK] Failed to release lock ${userId}:`, updateError);
        }
      }
    }
  } catch (scanError) {
    logger.error('[FORCE_UNLOCK] Error scanning for stuck locks:', scanError);
  }

  return unlockedCount;
}

export const handler = async (): Promise<void> => {
  logger.info('Lambda Concurrency Monitor: Checking account settings');

  try {
    try {
      const { LambdaClient, GetAccountSettingsCommand } = await import('@aws-sdk/client-lambda');
      const lambdaClient = new LambdaClient({});
      const command = new GetAccountSettingsCommand({});
      const response = await lambdaClient.send(command);
      const settings = response as unknown as LambdaAccountSettings;

      const unreserved = settings.AccountSnapshots?.[0]?.UnreservedConcurrentExecutions;

      if (!unreserved || unreserved.Remaining === undefined || unreserved.Capacity === undefined) {
        logger.warn('Lambda Concurrency Monitor: Unable to get concurrent execution stats');
        return;
      }

      const { Remaining, Capacity } = unreserved;
      const used = Capacity - Remaining;
      const utilizationPercent = Math.round((used / Capacity) * 100);

      await db.send(
        new PutCommand({
          TableName: typedResource.MemoryTable.name,
          Item: {
            userId: CONCURRENCY_KEY,
            timestamp: Date.now(),
            used,
            capacity: Capacity,
            remaining: Remaining,
            utilizationPercent,
            expiresAt: Math.floor(Date.now() / 1000) + CONCURRENCY_METRICS_TTL_SECONDS,
          },
        })
      );

      logger.info(`Lambda Concurrency: ${used}/${Capacity} (${utilizationPercent}%)`);

      if (utilizationPercent >= ALERT_THRESHOLD_PERCENT) {
        logger.warn(
          `Lambda Concurrency ALERT: ${utilizationPercent}% utilization (threshold: ${ALERT_THRESHOLD_PERCENT}%)`
        );

        await emitEvent('system.monitor', EventType.OUTBOUND_MESSAGE, {
          userId: 'ADMIN',
          message: `⚠️ *Lambda Concurrency Alert*\n\nCurrent utilization: ${utilizationPercent}%\nUsed: ${used}/${Capacity}\n\nConsider scaling or investigating runaway invocations.`,
          agentName: 'ConcurrencyMonitor',
        });
      }
    } catch {
      logger.info('Lambda SDK not available, skipping concurrency check');
    }
  } catch (error) {
    logger.error('Lambda Concurrency Monitor: Error checking settings', error);
  }
};
