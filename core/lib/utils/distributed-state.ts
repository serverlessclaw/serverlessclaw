import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../logger';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = (Resource as any).MemoryTable?.name || 'MemoryTable';

/**
 * Distributed State Utilities for Circuit Breakers and Rate Limiting.
 * Uses MemoryTable with TTL for cross-Lambda coordination.
 */
export class DistributedState {
  /**
   * Checks if a circuit breaker is open.
   */
  static async isCircuitOpen(key: string, threshold: number, timeoutMs: number): Promise<boolean> {
    try {
      const fullKey = `CIRCUIT#${key}`;
      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { userId: fullKey, timestamp: 0 },
        })
      );

      const state = result.Item;
      if (!state) return false;

      if ((state.count as number) >= threshold) {
        const now = Date.now();
        const openedAt = state.openedAt as number | undefined;

        if (openedAt && now - openedAt < timeoutMs) {
          return true; // Circuit is open and within timeout
        }

        // Circuit timeout has expired - explicitly reset count to prevent immediate re-open
        // This ensures the circuit properly closes before allowing traffic again
        if (openedAt) {
          try {
            await docClient.send(
              new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { userId: fullKey, timestamp: 0 },
                UpdateExpression: 'SET #count = :zero, openedAt = :null',
                ExpressionAttributeNames: { '#count': 'count' },
                ExpressionAttributeValues: { ':zero': 0, ':null': null },
              })
            );
            logger.info(`[DISTRIBUTED_STATE] Circuit ${key} reset after timeout`);
          } catch (resetErr) {
            // Race condition - another Lambda may have already handled it
            logger.debug(`[DISTRIBUTED_STATE] Circuit reset race for ${key}:`, resetErr);
          }
        }
        return false;
      }
      return false;
    } catch (e) {
      logger.warn(`[DISTRIBUTED_STATE] Circuit check failed for ${key}:`, e);
      return false; // Fail closed (allow traffic)
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

      await docClient.send(
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

      // Check if we just crossed the threshold and need to set openedAt
      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { userId: fullKey, timestamp: 0 },
        })
      );

      if (result.Item && (result.Item.count as number) >= threshold && !result.Item.openedAt) {
        await docClient
          .send(
            new UpdateCommand({
              TableName: TABLE_NAME,
              Key: { userId: fullKey, timestamp: 0 },
              UpdateExpression: 'SET openedAt = :now',
              ConditionExpression: 'attribute_not_exists(openedAt)',
              ExpressionAttributeValues: { ':now': now },
            })
          )
          .catch(() => {}); // Ignore condition failure if someone else set it
      }
    } catch (e) {
      logger.error(`[DISTRIBUTED_STATE] Failed to record failure for ${key}:`, e);
    }
  }

  /**
   * Consumes a token for rate limiting.
   * Implements a distributed token bucket.
   */
  static async consumeToken(key: string, capacity: number, refillMs: number): Promise<boolean> {
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
        } catch (e: any) {
          if (e.name !== 'ConditionalCheckFailedException') throw e;
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

      if (!state) return true; // Safety fallback

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
    } catch (e: any) {
      if (e.name === 'ConditionalCheckFailedException') {
        // Race condition - retry once
        return DistributedState.consumeToken(key, capacity, refillMs);
      }
      logger.warn(`[DISTRIBUTED_STATE] Rate limit check failed for ${key}:`, e);
      return true; // Fail open
    }
  }
}
