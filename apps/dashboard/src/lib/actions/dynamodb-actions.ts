'use server';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { revalidatePath } from 'next/cache';
import { logger } from '@claw/core/lib/logger';
import { getMemoryTableName } from '@claw/core/lib/utils/ddb-client';

/**
 * Deletes a memory item from DynamoDB by userId and timestamp.
 * Used to remove gaps, locks, or other memory items.
 *
 * @param userId - The userId (partition key) of the item to delete.
 * @param timestamp - The timestamp (sort key) of the item to delete.
 * @param revalidatePathString - The Next.js path to revalidate after deletion.
 */
export async function deleteMemoryItem(
  userId: string,
  timestamp: number | string,
  revalidatePathString: string
): Promise<void> {
  try {
    const tableName = getMemoryTableName();

    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);

    await docClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { userId, timestamp },
      })
    );

    revalidatePath(revalidatePathString);
  } catch (e) {
    logger.error('Error deleting memory item:', e);
    throw e;
  }
}
