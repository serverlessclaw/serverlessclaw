/**
 * @module LockManager
 * @description Unified distributed locking mechanism using DynamoDB conditional updates.
 * Supports TTL-based expiration and owner-based renewal/release.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../logger';

export interface LockOptions {
  ttlSeconds: number;
  ownerId: string;
  prefix?: string;
}

export class LockManager {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;
  private defaultPrefix: string = 'LOCK#';

  constructor(client?: DynamoDBClient) {
    const dbClient = client || new DynamoDBClient({});
    this.docClient = DynamoDBDocumentClient.from(dbClient);
    try {
      this.tableName = (Resource as Record<string, any>).MemoryTable.name;
    } catch {
      this.tableName = process.env.MEMORY_TABLE_NAME || 'MemoryTable';
    }
  }

  private getFullId(lockId: string, prefix?: string): string {
    const p = prefix !== undefined ? prefix : this.defaultPrefix;
    return lockId.startsWith(p) ? lockId : `${p}${lockId}`;
  }

  /**
   * Attempts to acquire a distributed lock.
   */
  async acquire(lockId: string, options: LockOptions): Promise<boolean> {
    const fullId = this.getFullId(lockId, options.prefix);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + options.ttlSeconds;

    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: fullId,
            timestamp: 0,
          },
          UpdateExpression:
            'SET ownerId = :owner, expiresAt = :exp, acquiredAt = :now, lockType = :type',
          ConditionExpression:
            'attribute_not_exists(ownerId) OR ownerId = :null OR ownerId = :owner OR expiresAt < :now',
          ExpressionAttributeValues: {
            ':owner': options.ownerId,
            ':exp': expiresAt,
            ':now': now,
            ':null': null,
            ':type': 'DISTRIBUTED_LOCK',
          },
        })
      );
      logger.debug(`Lock [${fullId}] acquired by ${options.ownerId}`);
      return true;
    } catch (error: unknown) {
      if ((error as any).name === 'ConditionalCheckFailedException') {
        logger.debug(`Lock [${fullId}] acquisition failed: already held or not expired.`);
        return false;
      }
      logger.error(`Error acquiring lock [${fullId}]:`, error);
      throw error;
    }
  }

  /**
   * Renews an existing lock if the owner still holds it.
   */
  async renew(lockId: string, options: LockOptions): Promise<boolean> {
    const fullId = this.getFullId(lockId, options.prefix);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + options.ttlSeconds;

    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: fullId,
            timestamp: 0,
          },
          UpdateExpression: 'SET expiresAt = :exp, renewedAt = :now',
          ConditionExpression: 'ownerId = :owner',
          ExpressionAttributeValues: {
            ':owner': options.ownerId,
            ':exp': expiresAt,
            ':now': now,
          },
        })
      );
      return true;
    } catch (error: unknown) {
      if ((error as any).name === 'ConditionalCheckFailedException') {
        logger.warn(`Lock [${fullId}] renewal failed: owner mismatch or lock lost.`);
        return false;
      }
      logger.error(`Error renewing lock [${fullId}]:`, error);
      throw error;
    }
  }

  /**
   * Explicitly releases a lock if the owner still holds it and it hasn't expired.
   */
  async release(lockId: string, ownerId: string, prefix?: string): Promise<boolean> {
    const fullId = this.getFullId(lockId, prefix);
    const now = Math.floor(Date.now() / 1000);
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: fullId,
            timestamp: 0,
          },
          UpdateExpression: 'REMOVE ownerId, expiresAt, acquiredAt, lockType, renewedAt',
          ConditionExpression: 'ownerId = :owner AND expiresAt > :now',
          ExpressionAttributeValues: {
            ':owner': ownerId,
            ':now': now,
          },
        })
      );
      logger.debug(`Lock [${fullId}] released by ${ownerId}`);
      return true;
    } catch (error: unknown) {
      if ((error as any).name === 'ConditionalCheckFailedException') {
        logger.debug(`Lock [${fullId}] release rejected: owner mismatch or lock already expired.`);
        return false;
      }
      logger.error(`Error releasing lock [${fullId}]:`, error);
      throw error;
    }
  }
}
