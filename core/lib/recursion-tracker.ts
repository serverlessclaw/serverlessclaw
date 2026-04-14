/**
 * Cross-Session Recursion Tracker
 * Tracks recursion depth across sessions to prevent bypass in swarm scenarios
 */

import { logger } from './logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const RECURSION_STACK_PREFIX = 'RECURSION_STACK#';
const RECURSION_TTL_SECONDS = 3600; // 1 hour - matches typical mission lifetime
const MISSION_RECURSION_TTL_SECONDS = 1800; // 30 minutes - stricter for mission-critical flows

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Record a recursion entry in the cross-session stack
 * @param traceId - The trace ID for the execution chain
 * @param depth - Current recursion depth
 * @param sessionId - Current session ID
 * @param agentId - Current agent ID
 * @param isMission - Whether this is a mission-critical workflow (uses shorter TTL)
 */
export async function pushRecursionEntry(
  traceId: string,
  depth: number,
  sessionId: string,
  agentId: string,
  isMission: boolean = false
): Promise<void> {
  const key = `${RECURSION_STACK_PREFIX}${traceId}`;
  const ttlSeconds = isMission ? MISSION_RECURSION_TTL_SECONDS : RECURSION_TTL_SECONDS;
  try {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

    // Use UpdateCommand with existence check - first entry sets the depth
    await docClient.send(
      new UpdateCommand({
        TableName: process.env.MEMORY_TABLE_NAME ?? 'MemoryTable',
        Key: {
          userId: key,
          timestamp: 0,
        },
        UpdateExpression:
          'SET #depth = :depth, sessionId = :sessionId, agentId = :agentId, createdAt = :now, expiresAt = :exp, #type = :type',
        ConditionExpression: 'attribute_not_exists(#depth)',
        ExpressionAttributeNames: {
          '#type': 'type',
          '#depth': 'depth',
        },
        ExpressionAttributeValues: {
          ':depth': depth,
          ':sessionId': sessionId,
          ':agentId': agentId,
          ':now': Date.now(),
          ':exp': expiresAt,
          ':type': 'RECURSION_ENTRY',
        },
      })
    );

    logger.info(
      `[RECURSION] Pushed entry for trace ${traceId}: depth=${depth}, agent=${agentId}, mission=${isMission}`
    );
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === 'ConditionalCheckFailedException') {
      // Entry exists - try to update depth atomically with increment
      // This handles concurrent pushes at the same level properly
      try {
        const currentDepth = await getRecursionDepth(traceId);
        const newDepth = Math.max(currentDepth + 1, depth);
        await docClient.send(
          new UpdateCommand({
            TableName: process.env.MEMORY_TABLE_NAME ?? 'MemoryTable',
            Key: {
              userId: key,
              timestamp: 0,
            },
            UpdateExpression: 'SET #depth = :depth, agentId = :agentId, createdAt = :now',
            ConditionExpression: '#depth = :currentDepth',
            ExpressionAttributeNames: {
              '#depth': 'depth',
            },
            ExpressionAttributeValues: {
              ':depth': newDepth,
              ':agentId': agentId,
              ':now': Date.now(),
              ':currentDepth': currentDepth,
            },
          })
        );
        logger.info(
          `[RECURSION] Incremented depth for trace ${traceId}: ${currentDepth} -> ${newDepth}`
        );
      } catch {
        logger.debug(`[RECURSION] Concurrent update for ${traceId}: another branch updated first`);
      }
      return;
    }
    logger.warn(`[RECURSION] Failed to push entry for ${traceId}:`, error);
  }
}

/**
 * Get the current recursion depth for a trace
 * @param traceId - The trace ID for the execution chain
 * @returns Current depth, -1 on error (sentinel value to distinguish from no entry)
 */
export async function getRecursionDepth(traceId: string): Promise<number> {
  try {
    const key = `${RECURSION_STACK_PREFIX}${traceId}`;
    const result = await docClient.send(
      new GetCommand({
        TableName: process.env.MEMORY_TABLE_NAME ?? 'MemoryTable',
        Key: { userId: key, timestamp: 0 },
      })
    );

    if (result.Item) {
      return (result.Item.depth as number) ?? 0;
    }

    return 0;
  } catch (error) {
    logger.warn(`[RECURSION] Failed to get depth for ${traceId}:`, error);
    return -1; // Return -1 to distinguish errors from no-entry (0)
  }
}

/**
 * Clear recursion entries for a trace after completion.
 * Uses conditional delete to prevent clearing while another agent chain is actively using it.
 * @param traceId - The trace ID for the execution chain
 */
export async function clearRecursionStack(traceId: string): Promise<void> {
  try {
    const key = `${RECURSION_STACK_PREFIX}${traceId}`;

    await docClient.send(
      new DeleteCommand({
        TableName: process.env.MEMORY_TABLE_NAME ?? 'MemoryTable',
        Key: { userId: key, timestamp: 0 },
        ConditionExpression: 'attribute_exists(#depth)',
        ExpressionAttributeNames: {
          '#depth': 'depth',
        },
      })
    );

    logger.info(`[RECURSION] Cleared stack for trace ${traceId}`);
  } catch (error) {
    logger.warn(`[RECURSION] Failed to clear stack for ${traceId}:`, error);
  }
}

/**
 * Check if trace is part of an active recursion chain
 * @param traceId - The trace ID for the execution chain
 * @returns true if trace has existing recursion entries
 */
export async function isRecursionActive(traceId: string): Promise<boolean> {
  const depth = await getRecursionDepth(traceId);
  return depth > 0;
}
