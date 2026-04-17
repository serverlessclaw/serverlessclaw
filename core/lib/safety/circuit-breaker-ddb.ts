import { logger } from '../logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const CIRCUIT_PREFIX = 'CIRCUIT#';

export class DistributedSafetyControl {
  private tableName: string;

  constructor() {
    this.tableName = process.env.MEMORY_TABLE_NAME ?? 'MemoryTable';
  }

  /**
   * Distributed rate limiting using token bucket algorithm in DynamoDB.
   * Uses atomic conditional updates to prevent race conditions.
   */
  async consumeToken(key: string, capacity: number, refillMs: number): Promise<boolean> {
    const now = Date.now();

    try {
      // Calculate token refill based on time elapsed
      // Use atomic conditional update to consume token in single operation
      const windowId = Math.floor(now / refillMs);
      const pk = `safety:token_bucket:${key}:${windowId}`;

      // Use atomic update with condition - only succeeds if tokens available
      await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { userId: pk, timestamp: 0 },
          UpdateExpression: 'SET #c = if_not_exists(#c, :cap) - :one, #lr = :now, expiresAt = :exp',
          ConditionExpression: 'attribute_not_exists(#c) OR #c > :zero',
          ExpressionAttributeNames: { '#c': 'tokens', '#lr': 'lastRefill' },
          ExpressionAttributeValues: {
            ':cap': capacity,
            ':one': 1,
            ':zero': 0,
            ':now': now,
            ':exp': Math.floor(now / 1000) + 3600,
          },
          ReturnValues: 'ALL_NEW',
        })
      );
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        // Token exhausted - return false (rate limited)
        return false;
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
