import { describe, it, expect, beforeEach } from 'vitest';
import { incrementRecursionDepth } from './recursion-tracker';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('RecursionTracker Atomicity', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('should correctly increment depth across concurrent calls', async () => {
    let currentDepth = 0;

    // Mock UpdateCommand to simulate successive increments
    ddbMock.on(UpdateCommand).callsFake(() => {
      currentDepth++;
      return {
        Attributes: {
          depth: currentDepth,
        },
      };
    });

    const traceId = 'test-trace-atomic';
    const sessionId = 'session-1';
    const agentId = 'agent-1';

    // Simulate 10 concurrent calls
    const results = await Promise.all(
      Array.from({ length: 10 }).map(() => incrementRecursionDepth(traceId, sessionId, agentId))
    );

    // Verify all calls succeeded and returned unique depths
    expect(results).toHaveLength(10);
    expect(new Set(results).size).toBe(10);
    expect(Math.max(...results)).toBe(10);
    expect(currentDepth).toBe(10);
  });

  it('should handle database errors gracefully', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB explicitly failed'));

    const result = await incrementRecursionDepth('error-trace', 's1', 'a1');
    expect(result).toBe(-1);
  });

  it('should use mission-specific TTL for mission contexts', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { depth: 1 },
    });

    await incrementRecursionDepth('mission-trace', 's1', 'a1', true);

    const lastCall = ddbMock.commandCalls(UpdateCommand)[0];
    const input = lastCall.args[0].input as any;
    const exp = input.ExpressionAttributeValues[':exp'];
    const now = Math.floor(Date.now() / 1000);

    // Mission TTL is 1800s (30m)
    expect(exp).toBeGreaterThanOrEqual(now + 1790);
    expect(exp).toBeLessThanOrEqual(now + 1810);
  });
});
