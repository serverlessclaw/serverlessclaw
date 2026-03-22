import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from './types/system';
import { ILockManager } from './types/system';
import { logger } from './logger';
import { TIME, LIMITS } from './constants';

// Default client for backward compatibility - can be overridden via constructor for testing
const defaultClient = new DynamoDBClient({});
const defaultDocClient = DynamoDBDocumentClient.from(defaultClient);
const typedResource = Resource as unknown as SSTResource;

const LOCK_PREFIX = 'LOCK#';
const DYNAMO_CONDITION_EXPRESSION = 'attribute_not_exists(userId) OR expiresAt < :now';
const DYNAMO_ERROR_CONDITIONAL_CHECK_FAILED = 'ConditionalCheckFailedException';

/**
 * DynamoDB-based lock manager implementation for distributed locking.
 */
export class DynamoLockManager implements ILockManager {
  private tableName: string = typedResource.MemoryTable.name;
  private readonly docClient: DynamoDBDocumentClient;

  /**
   * Creates a new DynamoLockManager instance.
   * @param docClient - Optional DynamoDB Document Client for dependency injection (useful for testing)
   */
  constructor(docClient?: DynamoDBDocumentClient) {
    this.docClient = docClient ?? defaultDocClient;
  }

  /**
   * Acquires a distributed lock using DynamoDB's conditional writes.
   *
   * @param lockId - Unique identifier for the lock.
   * @param ttlSeconds - Time-to-live for the lock in seconds.
   * @returns A promise that resolves to true if the lock was acquired, false otherwise.
   */
  async acquire(lockId: string, ttlSeconds: number = LIMITS.DEFAULT_LOCK_TTL): Promise<boolean> {
    const expiresAt = Math.floor(Date.now() / TIME.MS_PER_SECOND) + ttlSeconds;

    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        userId: `${LOCK_PREFIX}${lockId}`,
        timestamp: 0,
        expiresAt: expiresAt,
        acquiredAt: Date.now(),
      },
      ConditionExpression: DYNAMO_CONDITION_EXPRESSION,
      ExpressionAttributeValues: {
        ':now': Math.floor(Date.now() / TIME.MS_PER_SECOND),
      },
    });

    try {
      await this.docClient.send(command);
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === DYNAMO_ERROR_CONDITIONAL_CHECK_FAILED) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Releases a distributed lock by deleting its record from DynamoDB.
   *
   * @param lockId - Unique identifier for the lock to release.
   * @returns A promise that resolves when the release operation is complete.
   */
  async release(lockId: string): Promise<void> {
    const command = new DeleteCommand({
      TableName: this.tableName,
      Key: {
        userId: `${LOCK_PREFIX}${lockId}`,
        timestamp: 0,
      },
    });

    try {
      await this.docClient.send(command);
    } catch (error) {
      logger.error('Error releasing lock:', error);
    }
  }

  /**
   * Renews/extends a distributed lock's TTL.
   *
   * @param lockId - Unique identifier for the lock to renew.
   * @param additionalTtlSeconds - Additional time to add to the lock's TTL.
   * @returns A promise that resolves to true if renewed, false if lock doesn't exist or is held by another owner.
   */
  async renew(lockId: string, additionalTtlSeconds: number): Promise<boolean> {
    const newExpiresAt = Math.floor(Date.now() / TIME.MS_PER_SECOND) + additionalTtlSeconds;

    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        userId: `${LOCK_PREFIX}${lockId}`,
        timestamp: 0,
      },
      UpdateExpression: 'SET expiresAt = :newExpires, renewedAt = :renewedAt',
      ConditionExpression: 'attribute_exists(userId)',
      ExpressionAttributeValues: {
        ':newExpires': newExpiresAt,
        ':renewedAt': Date.now(),
      },
    });

    try {
      await this.docClient.send(command);
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === DYNAMO_ERROR_CONDITIONAL_CHECK_FAILED) {
        logger.warn(`Lock renewal failed: lock ${lockId} does not exist or was released`);
        return false;
      }
      throw error;
    }
  }
}
