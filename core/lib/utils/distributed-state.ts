import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';

import { getMemoryTableName } from './ddb-client';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = getMemoryTableName();

/**
 * Distributed State Utilities for Circuit Breakers and Rate Limiting.
 * Uses MemoryTable with TTL for cross-Lambda coordination.
 */
export class DistributedState {
  /**
   * Checks if a circuit breaker is open.
   * Enforces Principle 13 (Fail-Closed Strategy).
   */
  static async isCircuitOpen(key: string, threshold: number, timeoutMs: number): Promise<boolean> {
    try {
      const fullKey = `CIRCUIT#${key}`;
      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { userId: fullKey, timestamp: 0 },
          ConsistentRead: true,
        })
      );

      const state = result.Item;
      if (!state) return false;

      const count = (state.count as number) || 0;
      if (count >= threshold) {
        const now = Date.now();
        const openedAt = state.openedAt as number | undefined;

        // If count reached threshold but openedAt is missing, set it atomically
        if (!openedAt) {
          try {
            await docClient.send(
              new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { userId: fullKey, timestamp: 0 },
                UpdateExpression: 'SET openedAt = :now',
                ConditionExpression: 'attribute_not_exists(openedAt)',
                ExpressionAttributeValues: { ':now': now },
              })
            );
            return true;
          } catch (e: unknown) {
            if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return true; // Someone else set it
            throw e;
          }
        }

        if (now - openedAt < timeoutMs) {
          return true; // Circuit is open and within timeout
        }

        // Circuit timeout has expired - atomically reset
        try {
          await docClient.send(
            new UpdateCommand({
              TableName: TABLE_NAME,
              Key: { userId: fullKey, timestamp: 0 },
              UpdateExpression: 'SET #count = :zero, openedAt = :null',
              ConditionExpression: 'openedAt = :expectedOpenedAt',
              ExpressionAttributeNames: { '#count': 'count' },
              ExpressionAttributeValues: {
                ':zero': 0,
                ':null': null,
                ':expectedOpenedAt': openedAt,
              },
            })
          );
          logger.info(`[DISTRIBUTED_STATE] Circuit ${key} reset after timeout`);
        } catch (resetErr: unknown) {
          // Race condition - another Lambda may have already handled it or opened it again
          if ((resetErr as { name?: string }).name !== 'ConditionalCheckFailedException') {
            logger.debug(`[DISTRIBUTED_STATE] Circuit reset race for ${key}:`, resetErr);
          }
        }
        return false;
      }
      return false;
    } catch (e) {
      logger.error(`[DISTRIBUTED_STATE] Circuit check failed for ${key}:`, e);
      // Enforce Principle 13: Fail-Closed Strategy. If circuit status is unknown,
      // we must assume the circuit is open to prevent cascading failures.
      return true;
    }
  }

  /**
   * Records a failure for a circuit breaker.
   */
  static async recordFailure(key: string, threshold: number, timeoutMs: number): Promise<void> {
    try {
      const fullKey = `CIRCUIT#${key}`;
      const now = Date.now();
      const expiresAt = Math.floor((now + timeoutMs * 2) / 1000); // Buffer for TTL

      const updateResult = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { userId: fullKey, timestamp: 0 },
          UpdateExpression:
            'SET #count = if_not_exists(#count, :zero) + :one, #type = :type, expiresAt = :exp, updatedAt = :now',
          ExpressionAttributeNames: { '#count': 'count', '#type': 'type' },
          ExpressionAttributeValues: {
            ':zero': 0,
            ':one': 1,
            ':type': 'CIRCUIT_STATE',
            ':exp': expiresAt,
            ':now': now,
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      const attributes = updateResult.Attributes;
      const count = attributes?.count as number;

      // If we just crossed the threshold, set openedAt atomically
      if (count >= threshold && !attributes?.openedAt) {
        try {
          await docClient.send(
            new UpdateCommand({
              TableName: TABLE_NAME,
              Key: { userId: fullKey, timestamp: 0 },
              UpdateExpression: 'SET openedAt = :now',
              ConditionExpression: 'attribute_not_exists(openedAt)',
              ExpressionAttributeValues: { ':now': now },
            })
          );
        } catch (e: unknown) {
          if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
        }
      }
    } catch (e) {
      logger.error(`[DISTRIBUTED_STATE] Failed to record failure for ${key}:`, e);
    }
  }

  /**
   * Consumes a token for rate limiting.
   * Implements a distributed token bucket.
   * Enforces Principle 13 (Fail-Closed Strategy).
   */
  static async consumeToken(
    key: string,
    capacity: number,
    refillMs: number,
    retryCount = 0
  ): Promise<boolean> {
    if (retryCount >= 5) {
      // Enforce Principle 13: Fail-Closed Strategy after retries to ensure rate limit integrity.
      logger.warn(`[DISTRIBUTED_STATE] Rate limit retry limit exceeded for ${key}`);
      return false;
    }

    try {
      const fullKey = `RATE#${key}`;
      const now = Date.now();
      const expiresAt = Math.floor((now + refillMs * 2) / 1000);

      // 1. Get current bucket state
      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { userId: fullKey, timestamp: 0 },
        })
      );

      let state = result.Item;
      if (!state) {
        // Initialize bucket
        try {
          await docClient.send(
            new UpdateCommand({
              TableName: TABLE_NAME,
              Key: { userId: fullKey, timestamp: 0 },
              UpdateExpression:
                'SET #tokens = :tokens, lastRefill = :now, #type = :type, expiresAt = :exp',
              ConditionExpression: 'attribute_not_exists(userId)',
              ExpressionAttributeNames: { '#tokens': 'tokens', '#type': 'type' },
              ExpressionAttributeValues: {
                ':tokens': capacity - 1,
                ':now': now,
                ':type': 'RATE_BUCKET',
                ':exp': expiresAt,
              },
            })
          );
          return true;
        } catch (e: unknown) {
          if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
          // Someone else initialized it, fetch again
          const retry = await docClient.send(
            new GetCommand({
              TableName: TABLE_NAME,
              Key: { userId: fullKey, timestamp: 0 },
            })
          );
          state = retry.Item;
        }
      }

      if (!state) return true; // Safety fallback for corrupted record

      // 2. Calculate refill
      const lastRefill = state.lastRefill as number;
      const elapsed = now - lastRefill;
      const refillInterval = refillMs / capacity;
      const refillTokens = Math.floor(elapsed / refillInterval);

      const currentTokens = Math.min(capacity, (state.tokens as number) + refillTokens);

      if (currentTokens > 0) {
        // 3. Atomically consume token and update lastRefill
        const newLastRefill =
          refillTokens > 0 ? now - Math.floor(elapsed % refillInterval) : lastRefill;

        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { userId: fullKey, timestamp: 0 },
            UpdateExpression: 'SET #tokens = :newTokens, lastRefill = :newRefill, expiresAt = :exp',
            ConditionExpression: '#tokens = :expectedTokens AND lastRefill = :expectedRefill',
            ExpressionAttributeNames: { '#tokens': 'tokens' },
            ExpressionAttributeValues: {
              ':newTokens': currentTokens - 1,
              ':newRefill': newLastRefill,
              ':expectedTokens': state.tokens,
              ':expectedRefill': lastRefill,
              ':exp': expiresAt,
            },
          })
        );
        return true;
      }

      return false;
    } catch (e: unknown) {
      if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
        // Race condition - retry once
        return DistributedState.consumeToken(key, capacity, refillMs, retryCount + 1);
      }
      logger.error(`[DISTRIBUTED_STATE] Rate limit check failed for ${key}:`, e);
      // Enforce Principle 13: Fail-Closed Strategy. If rate limit status is unknown
      // due to system failure, we reject the operation to preserve stability.
      return false;
    }
  }
}
