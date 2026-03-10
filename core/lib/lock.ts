import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { ILockManager } from './types/index';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export class DynamoLockManager implements ILockManager {
  private tableName = Resource.MemoryTable.name; // Re-using table, but with a different partition key prefix or dedicated table

  async acquire(lockId: string, ttlSeconds: number = 30): Promise<boolean> {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        userId: `LOCK#${lockId}`,
        timestamp: 0,
        expiresAt: expiresAt,
        acquiredAt: Date.now(), // Store actual time in a non-key field if needed
      },
      ConditionExpression: 'attribute_not_exists(userId) OR expiresAt < :now',
      ExpressionAttributeValues: {
        ':now': Math.floor(Date.now() / 1000),
      },
    });

    try {
      await docClient.send(command);
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw error;
    }
  }

  async release(lockId: string): Promise<void> {
    const command = new DeleteCommand({
      TableName: this.tableName,
      Key: {
        userId: `LOCK#${lockId}`,
        timestamp: 0,
      },
    });

    try {
      await docClient.send(command);
    } catch (error) {
      console.error('Error releasing lock:', error);
    }
  }
}
