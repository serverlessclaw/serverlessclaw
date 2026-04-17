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

import { SYSTEM, DYNAMO_KEYS } from './constants';
import { ConfigManager } from './registry/config';
import { parseConfigInt } from './providers/utils';
import { getMemoryTableName } from './utils/ddb-client';

const RECURSION_STACK_PREFIX = 'RECURSION_STACK#';
const RECURSION_TTL_SECONDS = 3600; // 1 hour - matches typical mission lifetime
const MISSION_RECURSION_TTL_SECONDS = 1800; // 30 minutes - stricter for mission-critical flows

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Get the recursion limit from config or use default.
 * Validates that mission_recursion_limit <= recursion_limit to prevent limit bypass.
 * @param isMission - Whether this is a mission-critical workflow (uses stricter limit)
 */
export async function getRecursionLimit(isMission: boolean = false): Promise<number> {
  const { CONFIG_DEFAULTS } = await import('./config/config-defaults');

  // Get general recursion limit (upper bound)
  let generalLimit: number = SYSTEM.DEFAULT_RECURSION_LIMIT;
  try {
    const customLimit = await ConfigManager.getRawConfig(DYNAMO_KEYS.RECURSION_LIMIT);
    if (customLimit !== undefined) {
      generalLimit = parseConfigInt(customLimit, SYSTEM.DEFAULT_RECURSION_LIMIT);
    }
  } catch {
    logger.warn('Failed to fetch recursion_limit from DDB, using default.');
  }

  // Use mission-specific limit if this is a mission context
  if (isMission) {
    let missionLimit: number = CONFIG_DEFAULTS.MISSION_RECURSION_LIMIT.code;
    try {
      const customMissionLimit = await ConfigManager.getRawConfig('mission_recursion_limit');
      if (customMissionLimit !== undefined) {
        missionLimit = parseConfigInt(
          customMissionLimit,
          CONFIG_DEFAULTS.MISSION_RECURSION_LIMIT.code
        );
      }
    } catch {
      logger.warn('Failed to fetch mission_recursion_limit from DDB, using default.');
    }

    // Validate: mission limit cannot exceed general limit (prevents limit bypass)
    if (missionLimit > generalLimit) {
      logger.warn(
        `mission_recursion_limit (${missionLimit}) exceeds recursion_limit (${generalLimit}). ` +
          `Using general limit for mission context.`
      );
      return generalLimit;
    }

    return missionLimit;
  }

  return generalLimit;
}

/**
 * Atomically increments the recursion depth for a trace and returns the new depth.
 * Uses monotonic depth updates to prevent safety bypass in concurrent scenarios.
 *
 * @param traceId - The trace ID for the execution chain
 * @param sessionId - Current session ID
 * @param agentId - Current agent ID
 * @param isMission - Whether this is a mission-critical workflow
 * @returns A promise resolving to the new depth if successful, or -1 on error.
 */
export async function incrementRecursionDepth(
  traceId: string,
  sessionId: string,
  agentId: string,
  isMission: boolean = false
): Promise<number> {
  const key = `${RECURSION_STACK_PREFIX}${traceId}`;
  const ttlSeconds = isMission ? MISSION_RECURSION_TTL_SECONDS : RECURSION_TTL_SECONDS;
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const now = Date.now();

  try {
    const response = await docClient.send(
      new UpdateCommand({
        TableName: getMemoryTableName(),
        Key: { userId: key, timestamp: 0 },
        UpdateExpression:
          'SET #depth = if_not_exists(#depth, :zero) + :one, sessionId = :sessionId, agentId = :agentId, updatedAt = :now, expiresAt = :exp, #type = :type',
        ExpressionAttributeNames: {
          '#type': 'type',
          '#depth': 'depth',
        },
        ExpressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':sessionId': sessionId,
          ':agentId': agentId,
          ':now': now,
          ':exp': expiresAt,
          ':type': 'RECURSION_ENTRY',
        },
        ReturnValues: 'UPDATED_NEW',
      })
    );

    const newDepth = response.Attributes?.depth as number;
    logger.info(`[RECURSION] Incremented depth for ${traceId} to ${newDepth} (Agent: ${agentId})`);
    return newDepth;
  } catch (error: unknown) {
    logger.warn(`[RECURSION] Failed to increment depth for ${traceId}:`, error);
    return -1;
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
    const response = await docClient.send(
      new GetCommand({
        TableName: getMemoryTableName(),
        Key: {
          userId: key,
          timestamp: 0,
        },
      })
    );

    if (response.Item && response.Item.depth !== undefined) {
      return response.Item.depth as number;
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
        TableName: getMemoryTableName(),
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
