import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DistributedState } from './distributed-state';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
    ConfigTable: { name: 'test-config-table' },
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DistributedState Concurrency Stress Test', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('should handle concurrent recordFailure calls without losing atomic openedAt setting', async () => {
    let count = 0;
    let openedAt: number | null = null;
    const threshold = 5;

    // Simulate concurrent DynamoDB behavior
    ddbMock.on(UpdateCommand).callsFake((params) => {
      const input = params as any;
      const updateExpr = input.UpdateExpression as string;
      if (updateExpr.includes('if_not_exists(#count, :zero) + :one')) {
        count++;
        return { Attributes: { count, openedAt } };
      }
      if (updateExpr.includes('SET openedAt = :now')) {
        if (input.ConditionExpression === 'attribute_not_exists(openedAt)') {
          if (openedAt) throw { name: 'ConditionalCheckFailedException' };
          openedAt = input.ExpressionAttributeValues[':now'];
          return {};
        }
      }
      return {};
    });

    // Fire 10 concurrent failure records
    await Promise.all(
      Array.from({ length: 10 }).map(() =>
        DistributedState.recordFailure('test-key', threshold, 1000)
      )
    );

    expect(count).toBe(10);
    expect(openedAt).not.toBeNull();
  });

  it('should handle concurrent consumeToken calls and prevent over-consumption', async () => {
    let tokens = 10;
    const capacity = 10;
    const key = 'test-token';

    ddbMock.on(GetCommand).callsFake(() => ({
      Item: {
        userId: `RATE#${key}`,
        timestamp: 0,
        tokens,
        lastRefill: Date.now(),
        type: 'RATE_BUCKET',
      },
    }));

    ddbMock.on(UpdateCommand).callsFake((params) => {
      const input = params as any;
      const condExpr = input.ConditionExpression as string;
      if (condExpr && condExpr.includes('#tokens = :expectedTokens')) {
        const expected = input.ExpressionAttributeValues[':expectedTokens'];
        if (tokens !== expected) throw { name: 'ConditionalCheckFailedException' };
        tokens = input.ExpressionAttributeValues[':newTokens'];
        return { Attributes: { tokens } };
      }
      return {};
    });

    // Try to consume 15 tokens concurrently when only 10 are available
    const results = await Promise.all(
      Array.from({ length: 15 }).map(() => DistributedState.consumeToken(key, capacity, 60000))
    );

    const successCount = results.filter((r) => r === true).length;
    // We expect exactly 10 successes if contention is handled perfectly by retries
    // and fail-closed logic prevents the extras.
    expect(successCount).toBeLessThanOrEqual(10);
    expect(tokens).toBeGreaterThanOrEqual(0);
  });
});
