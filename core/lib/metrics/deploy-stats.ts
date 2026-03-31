import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from '../types/system';
import { SYSTEM } from '../constants';
import { logger } from '../logger';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const typedResource = Resource as unknown as SSTResource;

/**
 * Retrieves the current deployment count for today.
 *
 * @returns A promise that resolves to the current deployment count.
 * @since 2026-03-19
 */
export async function getDeployCountToday(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const { Item } = await db.send(
    new GetCommand({
      TableName: typedResource.MemoryTable.name,
      Key: {
        userId: SYSTEM.DEPLOY_STATS_KEY ?? 'SYSTEM#DEPLOY_STATS',
        timestamp: 0,
      },
    })
  );

  return Item?.lastReset === today ? (Item?.count ?? 0) : 0;
}

/**
 * Atomically increments the deployment count for today.
 * Uses conditional expression to prevent race conditions where two concurrent
 * invocations could both read the same count and both increment, exceeding the limit.
 *
 * @param today - The current date string (YYYY-MM-DD).
 * @param limit - The maximum allowed count before blocking.
 * @returns A promise that resolves to true if incremented, false if limit reached.
 */
export async function incrementDeployCount(today: string, limit: number): Promise<boolean> {
  try {
    await db.send(
      new UpdateCommand({
        TableName: typedResource.MemoryTable.name,
        Key: {
          userId: SYSTEM.DEPLOY_STATS_KEY ?? 'SYSTEM#DEPLOY_STATS',
          timestamp: 0,
        },
        UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one, lastReset = :today',
        ConditionExpression: '#count < :limit',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':today': today, ':limit': limit },
      })
    );
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      logger.info('incrementDeployCount: limit reached, skipping increment.');
      return false;
    }
    throw error;
  }
}

/**
 * Rewards a deployment limit (decrements the count, floored at 0).
 * Uses a conditional write to prevent the counter from going negative,
 * which would silently grant extra deploy budget beyond the configured limit.
 *
 * @returns A promise that resolves when the count is rewarded.
 */
export async function rewardDeployLimit(): Promise<void> {
  try {
    await db.send(
      new UpdateCommand({
        TableName: typedResource.MemoryTable.name,
        Key: {
          userId: SYSTEM.DEPLOY_STATS_KEY ?? 'SYSTEM#DEPLOY_STATS',
          timestamp: 0,
        },
        UpdateExpression: 'SET #count = #count - :one',
        ConditionExpression: '#count > :zero',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
      })
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      logger.info('rewardDeployLimit: count already at 0, skipping decrement.');
      return;
    }
    throw error;
  }
}
