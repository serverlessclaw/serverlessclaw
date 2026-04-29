/**
 * @module LockManager
 * @description Unified distributed locking mechanism using DynamoDB conditional updates.
 * Supports TTL-based expiration and owner-based renewal/release.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { getMemoryTableName, getDocClient } from '../utils/ddb-client';

export interface LockOptions {
  ttlSeconds: number;
  ownerId: string;
  prefix?: string;
  workspaceId?: string;
}

interface LockState {
  ownerId?: string | null;
  expiresAt?: number;
}

export class LockManager {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;
  private defaultPrefix: string = 'LOCK#';

  constructor(_client?: DynamoDBClient) {
    this.docClient = getDocClient();
    this.tableName = getMemoryTableName() ?? 'MemoryTable';
  }

  private getFullId(lockId: string, options?: { prefix?: string; workspaceId?: string }): string {
    const p = options?.prefix !== undefined ? options.prefix : this.defaultPrefix;
    const baseId = lockId.startsWith(p) ? lockId : `${p}${lockId}`;
    return options?.workspaceId ? `WS#${options.workspaceId}#${baseId}` : baseId;
  }

  /**
   * Gets the current state of a lock.
   */
  private async getLockState(fullId: string): Promise<LockState> {
    try {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { userId: fullId, timestamp: 0 },
        })
      );
      return {
        ownerId: result.Item?.ownerId,
        expiresAt: result.Item?.expiresAt,
      };
    } catch {
      return {};
    }
  }

  /**
   * Attempts to acquire a distributed lock.
   * Uses a two-phase check to avoid race conditions where two processes
   * could both acquire an expired lock simultaneously.
   */
  async acquire(lockId: string, options: LockOptions): Promise<boolean> {
    const fullId = this.getFullId(lockId, {
      prefix: options.prefix,
      workspaceId: options.workspaceId,
    });
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + options.ttlSeconds;

    const conditionExpression =
      'attribute_not_exists(ownerId) OR ownerId = :null OR expiresAt < :now';

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
          ConditionExpression: conditionExpression,
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
      if ((error as Error).name === 'ConditionalCheckFailedException') {
        logger.debug(`Lock [${fullId}] acquisition failed: already held or not expired.`);
        try {
          const { EVOLUTION_METRICS } = await import('../metrics/evolution-metrics');
          EVOLUTION_METRICS.recordLockContention(lockId, options.ownerId, {
            workspaceId: options.workspaceId,
          });
        } catch {
          /* ignore metrics errors */
        }
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
    const fullId = this.getFullId(lockId, {
      prefix: options.prefix,
      workspaceId: options.workspaceId,
    });
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
      if ((error as Error).name === 'ConditionalCheckFailedException') {
        logger.warn(`Lock [${fullId}] renewal failed: owner mismatch or lock lost.`);
        return false;
      }
      logger.error(`Error renewing lock [${fullId}]:`, error);
      throw error;
    }
  }

  /**
   * Explicitly releases a lock if the owner still holds it.
   * Allows release if: (a) owner matches, OR (b) lock has expired and we're the last known owner.
   */
  async release(
    lockId: string,
    ownerId: string,
    options?: { prefix?: string; workspaceId?: string }
  ): Promise<boolean> {
    const fullId = this.getFullId(lockId, options);
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
          // Release if we own it, or if it's already expired (cleanup)
          ConditionExpression: 'ownerId = :owner OR expiresAt < :now',
          ExpressionAttributeValues: {
            ':owner': ownerId,
            ':now': now,
          },
        })
      );
      logger.debug(`Lock [${fullId}] released by ${ownerId}`);
      return true;
    } catch (error: unknown) {
      if ((error as Error).name === 'ConditionalCheckFailedException') {
        logger.debug(`Lock [${fullId}] release rejected: not owned by ${ownerId} and not expired.`);
        return false;
      }
      logger.error(`Error releasing lock [${fullId}]:`, error);
      throw error;
    }
  }
}
