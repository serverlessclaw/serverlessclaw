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

import { SYSTEM, DYNAMO_KEYS, CONFIG_KEYS } from './constants';
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

const RECURSION_TYPE = 'RECURSION_ENTRY';
const MISSION_RECURSION_CONFIG_KEY = 'mission_recursion_limit';
const DEFAULT_GLOBAL_BUDGET = 1_000_000;

/**
 * Get the recursion limit from config or use default.
 * Validates that mission_recursion_limit <= recursion_limit to prevent limit bypass.
 * @param options - Configuration options
 */
export async function getRecursionLimit(
  options: { isMissionContext?: boolean } = {}
): Promise<number> {
  const { isMissionContext = false } = options;
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
  if (isMissionContext) {
    let missionLimit: number = CONFIG_DEFAULTS.MISSION_RECURSION_LIMIT.code;
    try {
      const customMissionLimit = await ConfigManager.getRawConfig(MISSION_RECURSION_CONFIG_KEY);
      if (customMissionLimit !== undefined) {
        missionLimit = parseConfigInt(
          customMissionLimit,
          CONFIG_DEFAULTS.MISSION_RECURSION_LIMIT.code
        );
      }
    } catch {
      logger.warn('Failed to fetch mission_recursion_limit from DDB, using default.');
    }
    // Safety check: mission limit cannot exceed general limit
    return Math.min(missionLimit, generalLimit);
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
 * @param options - Configuration options
 * @returns A promise resolving to the new depth if successful, or -1 on error.
 */
/**
 * Internal helper for atomic trace metadata updates.
 */
async function _updateTraceMetadata(
  traceId: string,
  updates: {
    expression: string;
    names: Record<string, string>;
    values: Record<string, unknown>;
  },
  ttlSeconds: number = RECURSION_TTL_SECONDS
): Promise<Record<string, unknown> | null> {
  const key = `${RECURSION_STACK_PREFIX}${traceId}`;
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

  try {
    const response = await docClient.send(
      new UpdateCommand({
        TableName: getMemoryTableName(),
        Key: { userId: key, timestamp: 0 },
        UpdateExpression: updates.expression,
        ExpressionAttributeNames: {
          '#type': 'type',
          ...updates.names,
        },
        ExpressionAttributeValues: {
          ':now': Date.now(),
          ':exp': expiresAt,
          ':type': RECURSION_TYPE,
          ...updates.values,
        },
        ReturnValues: 'UPDATED_NEW',
      })
    );
    return response.Attributes ?? null;
  } catch (error) {
    logger.warn(`[RECURSION] Update failed for ${traceId}:`, error);
    return null;
  }
}

/**
 * Atomically increments the recursion depth for a trace and returns the new depth.
 */
export async function incrementRecursionDepth(
  traceId: string,
  sessionId: string,
  agentId: string,
  options: { isMissionContext?: boolean } = {}
): Promise<number> {
  const ttlSeconds = options.isMissionContext
    ? MISSION_RECURSION_TTL_SECONDS
    : RECURSION_TTL_SECONDS;

  const attributes = await _updateTraceMetadata(
    traceId,
    {
      expression:
        'SET #depth = if_not_exists(#depth, :zero) + :one, sessionId = :sessionId, agentId = :agentId, updatedAt = :now, expiresAt = :exp, #type = :type',
      names: { '#depth': 'depth' },
      values: { ':zero': 0, ':one': 1, ':sessionId': sessionId, ':agentId': agentId },
    },
    ttlSeconds
  );

  return (attributes?.depth as number) ?? -1;
}

/**
 * Atomically increments the token usage for a trace.
 */
export async function incrementTokenUsage(traceId: string, tokens: number): Promise<number> {
  if (!traceId || traceId === 'unknown') return -1;

  const attributes = await _updateTraceMetadata(traceId, {
    expression:
      'SET tokens = if_not_exists(tokens, :zero) + :tokens, updatedAt = :now, expiresAt = if_not_exists(expiresAt, :exp), #type = if_not_exists(#type, :type)',
    names: {},
    values: { ':zero': 0, ':tokens': tokens },
  });

  return (attributes?.tokens as number) ?? -1;
}

/**
 * Retrieves the current token usage for a trace.
 */
export async function getTraceUsage(traceId: string): Promise<number> {
  try {
    const key = `${RECURSION_STACK_PREFIX}${traceId}`;
    const response = await docClient.send(
      new GetCommand({
        TableName: getMemoryTableName(),
        Key: { userId: key, timestamp: 0 },
      })
    );
    return (response.Item?.tokens as number) ?? 0;
  } catch (error) {
    logger.warn(`[RecursionTracker] Failed to get usage for ${traceId}:`, error);
    return -1;
  }
}

/**
 * Checks if the cumulative token budget for a trace has been exceeded.
 * Scoped to workspaceId for proper multi-tenant enforcement.
 */
export async function isBudgetExceeded(traceId: string, workspaceId?: string): Promise<boolean> {
  try {
    const budget = await ConfigManager.getTypedConfig(
      CONFIG_KEYS.GLOBAL_TOKEN_BUDGET,
      DEFAULT_GLOBAL_BUDGET,
      { workspaceId }
    );

    const usage = await getTraceUsage(traceId);

    // Fail-Closed: If usage lookup failed, assume exceeded
    if (usage === -1) return true;

    if (usage >= (budget as number)) {
      logger.error(
        `[RecursionTracker] Trace ${traceId} exceeded token budget (${usage} >= ${budget})`
      );
      return true;
    }

    // Warning at 80%
    if (usage >= (budget as number) * 0.8) {
      logger.warn(
        `[RecursionTracker] Trace ${traceId} at 80% budget capacity (${usage}/${budget})`
      );
    }

    return false;
  } catch (e) {
    logger.error(`[RecursionTracker] Failed to check budget for ${traceId}:`, e);
    // Fail-Closed Principle: If we can't verify budget, assume exceeded to prevent runaway costs
    return true;
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
