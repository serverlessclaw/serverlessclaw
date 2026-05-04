import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { getDocClient } from './config';
import { getConfigTableName } from '../utils/ddb-client';
import { DYNAMO_KEYS } from '../constants';

/**
 * Handles atomic tool usage recording and management.
 */
export class ToolUsageRegistry {
  /**
   * Records tool usage atomically in the ConfigTable.
   */
  static async recordToolUsage(
    toolName: string,
    agentId: string = 'unknown',
    scope?: {
      workspaceId?: string;
      teamId?: string;
      staffId?: string;
    }
  ): Promise<void> {
    const now = Date.now();
    try {
      // 1. Global usage increment
      await this.atomicRecordToolUsage(DYNAMO_KEYS.TOOL_USAGE, toolName, now);

      // 2. Per-agent usage increment
      await this.atomicRecordToolUsage(`tool_usage_${agentId}`, toolName, now);

      // 3. Per-workspace/org/team/staff usage increment
      if (scope) {
        if (scope.workspaceId) {
          const workspaceUsageKey = `WS#${scope.workspaceId}#${DYNAMO_KEYS.TOOL_USAGE_PREFIX}`;
          await this.atomicRecordToolUsage(workspaceUsageKey, toolName, now);
        }
        if (scope.teamId) {
          const teamUsageKey = `TEAM#${scope.teamId}#${DYNAMO_KEYS.TOOL_USAGE_PREFIX}`;
          await this.atomicRecordToolUsage(teamUsageKey, toolName, now);
        }
        if (scope.staffId) {
          const staffUsageKey = `STAFF#${scope.staffId}#${DYNAMO_KEYS.TOOL_USAGE_PREFIX}`;
          await this.atomicRecordToolUsage(staffUsageKey, toolName, now);
        }
      }
    } catch (e) {
      logger.warn(`[ToolUsageRegistry] Failed to record tool usage for ${toolName}:`, e);
    }
  }

  /**
   * Internal helper to atomically record tool usage.
   */
  private static async atomicRecordToolUsage(
    key: string,
    toolName: string,
    timestamp: number
  ): Promise<void> {
    const tableName = getConfigTableName();
    if (!tableName) return;

    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        await getDocClient().send(
          new UpdateCommand({
            TableName: tableName,
            Key: { key },
            UpdateExpression:
              'SET #val.#tool.#count = if_not_exists(#val.#tool.#count, :zero) + :one, #val.#tool.#last = :now',
            ConditionExpression: 'attribute_exists(#val.#tool)',
            ExpressionAttributeNames: {
              '#val': 'value',
              '#tool': toolName,
              '#count': 'count',
              '#last': 'lastUsed',
            },
            ExpressionAttributeValues: { ':one': 1, ':zero': 0, ':now': timestamp },
          })
        );
        return;
      } catch (e: unknown) {
        if (
          e instanceof Error &&
          (e.name === 'ConditionalCheckFailedException' || e.name === 'ValidationException')
        ) {
          try {
            await getDocClient().send(
              new UpdateCommand({
                TableName: tableName,
                Key: { key },
                UpdateExpression: 'SET #val.#tool = :newStats',
                ConditionExpression: 'attribute_not_exists(#val.#tool)',
                ExpressionAttributeNames: { '#val': 'value', '#tool': toolName },
                ExpressionAttributeValues: {
                  ':newStats': { count: 1, lastUsed: timestamp, firstRegistered: timestamp },
                },
              })
            );
            return;
          } catch (innerE: unknown) {
            if (innerE instanceof Error && innerE.name === 'ConditionalCheckFailedException') {
              retryCount++;
              continue;
            }
            break;
          }
        } else {
          break;
        }
      }
    }
  }

  /**
   * Initializes firstRegistered timestamp for tools.
   */
  static async initializeToolStats(
    toolNames: string[],
    options?: { workspaceId?: string }
  ): Promise<void> {
    const tableName = getConfigTableName();
    if (!tableName || toolNames.length === 0) return;

    const key = options?.workspaceId
      ? `WS#${options.workspaceId}#${DYNAMO_KEYS.TOOL_USAGE_PREFIX}`
      : DYNAMO_KEYS.TOOL_USAGE;

    for (const toolName of toolNames) {
      const now = Date.now();
      try {
        await getDocClient().send(
          new UpdateCommand({
            TableName: tableName,
            Key: { key },
            UpdateExpression:
              'SET #val.#tool = if_not_exists(#val.#tool, :newStats), #val.#tool.#first = if_not_exists(#val.#tool.#first, :now)',
            ExpressionAttributeNames: {
              '#val': 'value',
              '#tool': toolName,
              '#first': 'firstRegistered',
            },
            ExpressionAttributeValues: {
              ':now': now,
              ':newStats': { count: 0, lastUsed: 0, firstRegistered: now },
            },
          })
        );
      } catch {
        // Best-effort
      }
    }
  }
}
