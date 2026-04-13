import { logger } from '../logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const CIRCUIT_PREFIX = 'CIRCUIT#';
const RATE_PREFIX = 'RATE#';

export class DistributedSafetyControl {
  private tableName: string;

  constructor() {
    this.tableName = (Resource as any).MemoryTable.name;
  }

  /**
   * Distributed rate limiting using token bucket algorithm in DynamoDB.
   */
  async consumeToken(key: string, capacity: number, refillMs: number): Promise<boolean> {
    const fullKey = `${RATE_PREFIX}${key}`;
    const now = Date.now();
    const refillInterval = refillMs / capacity;

    try {
      // 1. Get current bucket
      const result = await docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { userId: fullKey, timestamp: 0 },
        })
      );

      let { tokens, lastRefill } = result.Item || { tokens: capacity, lastRefill: now };

      // 2. Calculate refill
      const elapsed = now - lastRefill;
      if (elapsed >= refillInterval) {
        const refillTokens = Math.floor(elapsed / refillInterval);
        tokens = Math.min(capacity, tokens + refillTokens);
        lastRefill = now - Math.floor(elapsed % refillInterval);
      }

      if (tokens > 0) {
        // 3. Atomically consume token
        await docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { userId: fullKey, timestamp: 0 },
            UpdateExpression: 'SET tokens = :newTokens, lastRefill = :now, expiresAt = :exp',
            ConditionExpression: 'attribute_not_exists(tokens) OR tokens = :oldTokens',
            ExpressionAttributeValues: {
              ':newTokens': tokens - 1,
              ':oldTokens': tokens,
              ':now': lastRefill,
              ':exp': Math.floor(now / 1000) + 3600, // 1h TTL
            },
          })
        );
        return true;
      }
      return false;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        // Retry on race condition
        return this.consumeToken(key, capacity, refillMs);
      }
      logger.warn(`[SAFETY] Distributed rate limit check failed for ${key}:`, e);
      return true; // Fail open to prevent system-wide blockage
    }
  }

  /**
   * Distributed circuit breaker state management in DynamoDB.
   */
  async isCircuitOpen(key: string, threshold: number, timeoutMs: number): Promise<boolean> {
    const fullKey = `${CIRCUIT_PREFIX}${key}`;
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { userId: fullKey, timestamp: 0 },
        })
      );

      const state = result.Item as { count: number; openedAt?: number } | undefined;
      if (!state) return false;

      if (state.count >= threshold) {
        const now = Date.now();
        if (state.openedAt && now - state.openedAt < timeoutMs) {
          return true;
        }
        // Timeout elapsed - reset atomically
        await docClient
          .send(
            new UpdateCommand({
              TableName: this.tableName,
              Key: { userId: fullKey, timestamp: 0 },
              UpdateExpression: 'REMOVE openedAt SET #c = :zero',
              ExpressionAttributeNames: { '#c': 'count' },
              ExpressionAttributeValues: { ':zero': 0 },
            })
          )
          .catch(() => {});
        return false;
      }
      return false;
    } catch (e) {
      logger.warn(`[SAFETY] Distributed circuit check failed for ${key}:`, e);
      return false; // Fail closed (allow execution)
    }
  }

  /**
   * Record a failure for a specific service/key in the distributed circuit breaker.
   */
  async recordFailure(key: string, threshold: number): Promise<void> {
    const fullKey = `${CIRCUIT_PREFIX}${key}`;
    const now = Date.now();

    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { userId: fullKey, timestamp: 0 },
          UpdateExpression: 'SET #c = if_not_exists(#c, :zero) + :one, expiresAt = :exp',
          ExpressionAttributeNames: { '#c': 'count' },
          ExpressionAttributeValues: {
            ':one': 1,
            ':zero': 0,
            ':exp': Math.floor(now / 1000) + 86400, // 24h TTL
          },
          ReturnValues: 'ALL_NEW',
        })
      );
      const newCount = result.Attributes?.count as number;
      if (newCount >= threshold) {
        await docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { userId: fullKey, timestamp: 0 },
            UpdateExpression: 'SET openedAt = if_not_exists(openedAt, :now)',
            ExpressionAttributeValues: { ':now': now },
          })
        );
      }
    } catch (e) {
      logger.warn(`[SAFETY] Distributed record failure failed for ${key}:`, e);
    }
  }
}
