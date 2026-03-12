import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from './types/index';
import { SYSTEM } from './constants';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const typedResource = Resource as unknown as SSTResource;

/**
 * Retrieves the current deployment count for today.
 *
 * @returns A promise that resolves to the current deployment count.
 */
export async function getDeployCountToday(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const { Item } = await db.send(
    new GetCommand({
      TableName: typedResource.MemoryTable.name,
      Key: {
        userId: SYSTEM.DEPLOY_STATS_KEY || 'SYSTEM#DEPLOY_STATS',
        timestamp: 0,
      },
    })
  );

  return Item?.lastReset === today ? (Item?.count ?? 0) : 0;
}

/**
 * Increments the deployment count for today.
 *
 * @param today - The current date string (YYYY-MM-DD).
 * @param currentCount - The current count to increment from.
 * @returns A promise that resolves when the count is updated.
 */
export async function incrementDeployCount(today: string, currentCount: number): Promise<void> {
  await db.send(
    new UpdateCommand({
      TableName: typedResource.MemoryTable.name,
      Key: {
        userId: SYSTEM.DEPLOY_STATS_KEY || 'SYSTEM#DEPLOY_STATS',
        timestamp: 0,
      },
      UpdateExpression:
        currentCount === 0 ? 'SET #count = :one, lastReset = :today' : 'SET #count = #count + :inc',
      ExpressionAttributeNames: { '#count': 'count' },
      ExpressionAttributeValues: {
        ':one': 1,
        ':today': today,
        ':inc': 1,
      },
    })
  );
}

/**
 * Rewards a deployment limit (decrements the count).
 *
 * @returns A promise that resolves when the count is rewarded.
 */
export async function rewardDeployLimit(): Promise<void> {
  await db.send(
    new UpdateCommand({
      TableName: typedResource.MemoryTable.name,
      Key: {
        userId: SYSTEM.DEPLOY_STATS_KEY || 'SYSTEM#DEPLOY_STATS',
        timestamp: 0,
      },
      UpdateExpression: 'SET #count = if_not_exists(#count, :zero) - :one',
      ExpressionAttributeNames: { '#count': 'count' },
      ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
    })
  );
}
