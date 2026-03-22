import { EventBridgeEvent } from 'aws-lambda';
import { logger } from '../../lib/logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import type { SSTResource } from '../../lib/types/system';
import { TaskCancellation } from '../../lib/agent/schema';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const typedResource = Resource as unknown as SSTResource;
const CANCEL_PREFIX = 'CANCEL#';

export async function handleTaskCancellation(
  event: EventBridgeEvent<string, TaskCancellation>
): Promise<void> {
  const { taskId, initiatorId, reason } = event.detail;

  logger.info(`Task cancellation requested: taskId=${taskId}, initiatorId=${initiatorId}`);

  if (!taskId || !initiatorId) {
    logger.warn('Task cancellation received with missing required fields');
    return;
  }

  try {
    await db.send(
      new PutCommand({
        TableName: typedResource.MemoryTable.name,
        Item: {
          userId: `${CANCEL_PREFIX}${taskId}`,
          timestamp: Date.now(),
          type: 'TASK_CANCELLATION',
          initiatorId,
          reason: reason ?? 'No reason provided',
          cancelledAt: Date.now(),
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      })
    );

    logger.info(`Cancellation flag set for task ${taskId}`);
  } catch (error) {
    logger.error(`Failed to set cancellation flag for task ${taskId}:`, error);
    throw error;
  }
}

export async function isTaskCancelled(taskId: string): Promise<boolean> {
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  try {
    const result = await db.send(
      new QueryCommand({
        TableName: typedResource.MemoryTable.name,
        KeyConditionExpression: 'userId = :uid',
        ExpressionAttributeValues: {
          ':uid': `${CANCEL_PREFIX}${taskId}`,
        },
      })
    );
    return (result.Items?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
