/**
 * Lambda Concurrency Monitor
 *
 * Monitors Lambda concurrent execution usage and alerts when approaching limits.
 *
 * NOTE: Requires @aws-sdk/client-lambda to be installed for actual monitoring.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import type { SSTResource } from '../lib/types/system';
import { logger } from '../lib/logger';
import { emitEvent } from '../lib/utils/bus';
import { EventType } from '../lib/types/agent';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const typedResource = Resource as unknown as SSTResource;

const ALERT_THRESHOLD_PERCENT = 80;
const CONCURRENCY_KEY = 'SYSTEM#LAMBDA_CONCURRENCY';

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
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
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
