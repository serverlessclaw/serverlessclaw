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
 */
export async function pushRecursionEntry(
  traceId: string,
  depth: number,
  sessionId: string,
  agentId: string
): Promise<void> {
  try {
    const key = `${RECURSION_STACK_PREFIX}${traceId}`;
    const expiresAt = Math.floor(Date.now() / 1000) + RECURSION_TTL_SECONDS;

    // Sh1: Use UpdateCommand to ensure atomic depth increment and prevent concurrent "resets"
    await docClient.send(
      new UpdateCommand({
        TableName: process.env.MEMORY_TABLE_NAME ?? 'MemoryTable',
        Key: {
          userId: key,
          timestamp: 0,
        },
        UpdateExpression:
          'SET depth = :depth, sessionId = :sessionId, agentId = :agentId, createdAt = :now, expiresAt = :exp, #type = :type',
        ConditionExpression: 'attribute_not_exists(depth) OR depth < :depth',
        ExpressionAttributeNames: {
          '#type': 'type',
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

    logger.info(`[RECURSION] Pushed entry for trace ${traceId}: depth=${depth}, agent=${agentId}`);
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      logger.debug(`[RECURSION] Skip push for ${traceId}: existing depth is already >= ${depth}`);
      return;
    }
    logger.warn(`[RECURSION] Failed to push entry for ${traceId}:`, error);
  }
}

/**
 * Get the current recursion depth for a trace
 * @param traceId - The trace ID for the execution chain
 * @returns Current depth or 0 if no entry exists
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
    return 0;
  }
}

/**
 * Clear recursion entries for a trace after completion
 * @param traceId - The trace ID for the execution chain
 */
export async function clearRecursionStack(traceId: string): Promise<void> {
  try {
    const key = `${RECURSION_STACK_PREFIX}${traceId}`;

    await docClient.send(
      new DeleteCommand({
        TableName: process.env.MEMORY_TABLE_NAME ?? 'MemoryTable',
        Key: { userId: key, timestamp: 0 },
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
