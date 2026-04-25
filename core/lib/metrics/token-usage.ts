import { PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { getDocClient, getMemoryTableName } from '../utils/ddb-client';
import { TIME } from '../constants';

const docClient = getDocClient();

const TTL_DAYS_INVOCATION = 7;
const TTL_DAYS_ROLLUP = 90;

export interface TokenScope {
  workspaceId?: string;
  teamId?: string;
}

export interface TokenUsageRecord {
  userId: string;
  timestamp: number;
  traceId: string;
  agentId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCalls: number;
  taskType: 'agent_process' | 'summarization' | 'other';
  success: boolean;
  durationMs: number;
  expiresAt: number;
}

export interface TokenRollup {
  userId: string;
  timestamp: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  invocationCount: number;
  toolCalls: number;
  avgTokensPerInvocation: number;
  successCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  expiresAt: number;
}

export interface ToolTokenRollup {
  userId: string;
  timestamp: number;
  invocationCount: number;
  successCount: number;
  totalDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  expiresAt: number;
}

function getTableName(): string {
  return getMemoryTableName() ?? 'MemoryTable';
}

function dayStart(ts: number = Date.now()): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export class TokenTracker {
  static async recordInvocation(
    record: Omit<TokenUsageRecord, 'userId' | 'expiresAt'>,
    scope?: TokenScope
  ): Promise<void> {
    const now = Date.now();
    const expiresAt = Math.floor(now / 1000) + TTL_DAYS_INVOCATION * TIME.SECONDS_IN_DAY;

    // Determine prefix based on scope (WS > default)
    let prefix = 'GLOBAL';
    if (scope?.workspaceId) {
      prefix = `WS#${scope.workspaceId}`;
    }

    // P1 Fix: Maintain backward compatibility for tests and existing data
    // If no scope is provided, use the old format (prefixless) as primary
    const scopedUserId =
      scope?.workspaceId || scope?.teamId
        ? `${prefix}#TOKEN#${record.agentId}`
        : `TOKEN#${record.agentId}`;

    const items = [{ ...record, userId: scopedUserId, expiresAt } as TokenUsageRecord];

    // Only store GLOBAL copy if no scope is provided to reduce cross-tenant metadata leakage
    if (!scope?.workspaceId && !scope?.teamId) {
      const globalUserId = `GLOBAL#TOKEN#${record.agentId}`;
      if (scopedUserId !== globalUserId) {
        items.push({ ...record, userId: globalUserId, expiresAt } as TokenUsageRecord);
      }
    }

    try {
      await Promise.all(
        items.map((item) =>
          docClient.send(new PutCommand({ TableName: getTableName(), Item: item }))
        )
      );
    } catch (e) {
      logger.warn('Failed to record token invocation:', e);
    }
  }

  static async getInvocationHistory(
    agentId: string,
    limit = 20,
    scope?: TokenScope
  ): Promise<TokenUsageRecord[]> {
    let userId: string;

    if (scope?.workspaceId) {
      userId = `WS#${scope.workspaceId}#TOKEN#${agentId}`;
    } else if (scope?.teamId) {
      userId = `TEAM#${scope.teamId}#TOKEN#${agentId}`;
    } else {
      userId = `TOKEN#${agentId}`;
    }

    try {
      const { Items } = await docClient.send(
        new QueryCommand({
          TableName: getTableName(),
          KeyConditionExpression: 'userId = :pk',
          ExpressionAttributeValues: { ':pk': userId },
          ScanIndexForward: false,
          Limit: limit,
        })
      );
      return (Items as TokenUsageRecord[]) ?? [];
    } catch (e) {
      logger.warn('Failed to get token invocation history:', e);
      return [];
    }
  }

  static async updateRollup(
    agentId: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      toolCalls: number;
      success: boolean;
      durationMs?: number;
    },
    scope?: TokenScope
  ): Promise<void> {
    const ts = dayStart();
    const expiresAt = Math.floor(Date.now() / 1000) + TTL_DAYS_ROLLUP * TIME.SECONDS_IN_DAY;

    const rollupKeys = [];
    if (!scope || (!scope.workspaceId && !scope.teamId)) {
      rollupKeys.push(`TOKEN_ROLLUP#${agentId}`);
    } else {
      rollupKeys.push(`GLOBAL#TOKEN_ROLLUP#${agentId}`);
      if (scope.workspaceId) rollupKeys.push(`WS#${scope.workspaceId}#TOKEN_ROLLUP#${agentId}`);
      if (scope.teamId) rollupKeys.push(`TEAM#${scope.teamId}#TOKEN_ROLLUP#${agentId}`);
    }

    for (const userId of rollupKeys) {
      try {
        // Store individual duration for percentile calculation (keep last 1000)
        const durationSample = usage.durationMs ?? 0;

        const result = await docClient.send(
          new UpdateCommand({
            TableName: getTableName(),
            Key: { userId, timestamp: ts },
            UpdateExpression:
              'SET totalInputTokens = if_not_exists(totalInputTokens, :zero) + :inTok, ' +
              'totalOutputTokens = if_not_exists(totalOutputTokens, :zero) + :outTok, ' +
              'invocationCount = if_not_exists(invocationCount, :zero) + :one, ' +
              'toolCalls = if_not_exists(toolCalls, :zero) + :tools, ' +
              'successCount = if_not_exists(successCount, :zero) + :success, ' +
              'totalDurationMs = if_not_exists(totalDurationMs, :zero) + :dur, ' +
              'durationSamples = list_append(if_not_exists(durationSamples, :empty), :sample), ' +
              'expiresAt = :expires',
            ExpressionAttributeValues: {
              ':inTok': usage.inputTokens,
              ':outTok': usage.outputTokens,
              ':one': 1,
              ':tools': usage.toolCalls,
              ':success': usage.success ? 1 : 0,
              ':dur': usage.durationMs ?? 0,
              ':zero': 0,
              ':expires': expiresAt,
              ':sample': [durationSample],
              ':empty': [],
            },
            ReturnValues: 'ALL_NEW',
          })
        );

        const updated = result.Attributes;
        if (updated && updated.invocationCount > 0) {
          const avgTokens =
            (updated.totalInputTokens + updated.totalOutputTokens) / updated.invocationCount;
          const avgDuration = (updated.totalDurationMs ?? 0) / updated.invocationCount;

          // Calculate percentiles from duration samples
          const samples = (updated.durationSamples as number[]) || [];
          const sortedSamples = samples.slice(-1000).sort((a, b) => a - b);
          const p50Idx = Math.floor(sortedSamples.length * 0.5);
          const p95Idx = Math.floor(sortedSamples.length * 0.95);
          const p99Idx = Math.floor(sortedSamples.length * 0.99);

          const p50Duration = sortedSamples.length > 0 ? (sortedSamples[p50Idx] ?? 0) : 0;
          const p95Duration = sortedSamples.length > 0 ? (sortedSamples[p95Idx] ?? 0) : 0;
          const p99Duration = sortedSamples.length > 0 ? (sortedSamples[p99Idx] ?? 0) : 0;

          await docClient.send(
            new UpdateCommand({
              TableName: getTableName(),
              Key: { userId, timestamp: ts },
              UpdateExpression:
                'SET avgTokensPerInvocation = :avgTokens, avgDurationMs = :avgDur, p50DurationMs = :p50, p95DurationMs = :p95, p99DurationMs = :p99, durationSamples = :samples',
              ExpressionAttributeValues: {
                ':avgTokens': avgTokens,
                ':avgDur': avgDuration,
                ':p50': p50Duration,
                ':p95': p95Duration,
                ':p99': p99Duration,
                ':samples': sortedSamples.slice(-1000),
              },
              ConditionExpression: 'attribute_exists(invocationCount)',
            })
          );
        }
      } catch (e) {
        if ((e as Error).name !== 'ConditionalCheckFailedException') {
          logger.warn(`Failed to update token rollup for ${userId}:`, e);
        }
      }
    }
  }

  static async getRollup(
    agentId: string,
    date?: string,
    scope?: TokenScope
  ): Promise<TokenRollup | null> {
    const ts = date ? dayStart(new Date(date).getTime()) : dayStart();

    let userId: string;
    if (scope?.workspaceId) {
      userId = `WS#${scope.workspaceId}#TOKEN_ROLLUP#${agentId}`;
    } else if (scope?.teamId) {
      userId = `TEAM#${scope.teamId}#TOKEN_ROLLUP#${agentId}`;
    } else {
      userId = `TOKEN_ROLLUP#${agentId}`;
    }
    try {
      const { Items } = await docClient.send(
        new QueryCommand({
          TableName: getTableName(),
          KeyConditionExpression: 'userId = :pk AND #ts = :sk',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':pk': userId, ':sk': ts },
          Limit: 1,
        })
      );
      return (Items?.[0] as TokenRollup) ?? null;
    } catch (error) {
      logger.debug('Failed to query token rollup', { userId, error });
      return null;
    }
  }

  static async getRollupRange(
    agentId: string,
    days: number,
    scope?: TokenScope
  ): Promise<TokenRollup[]> {
    const endTs = dayStart();
    const startTs = endTs - days * TIME.SECONDS_IN_DAY * 1000;

    let userId: string;
    if (scope?.workspaceId) {
      userId = `WS#${scope.workspaceId}#TOKEN_ROLLUP#${agentId}`;
    } else if (scope?.teamId) {
      userId = `TEAM#${scope.teamId}#TOKEN_ROLLUP#${agentId}`;
    } else {
      userId = `TOKEN_ROLLUP#${agentId}`;
    }

    try {
      const { Items } = await docClient.send(
        new QueryCommand({
          TableName: getTableName(),
          KeyConditionExpression: 'userId = :pk AND #ts BETWEEN :start AND :end',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: {
            ':pk': userId,
            ':start': startTs,
            ':end': endTs,
          },
          ScanIndexForward: false,
        })
      );
      return (Items as TokenRollup[]) ?? [];
    } catch (error) {
      logger.debug('Failed to query token rollup range', { agentId, days, error });
      return [];
    }
  }

  static async updateToolRollup(
    toolName: string,
    success: boolean,
    durationMs?: number,
    inputTokens?: number,
    outputTokens?: number,
    scope?: TokenScope
  ): Promise<void> {
    const ts = dayStart();
    const expiresAt = Math.floor(Date.now() / 1000) + TTL_DAYS_ROLLUP * TIME.SECONDS_IN_DAY;

    const rollupKeys = [];
    if (!scope || (!scope.workspaceId && !scope.teamId)) {
      rollupKeys.push(`TOOL_TOKEN#${toolName}`);
    } else {
      rollupKeys.push(`GLOBAL#TOOL_TOKEN#${toolName}`);
      if (scope.workspaceId) rollupKeys.push(`WS#${scope.workspaceId}#TOOL_TOKEN#${toolName}`);
      if (scope.teamId) rollupKeys.push(`TEAM#${scope.teamId}#TOOL_TOKEN#${toolName}`);
    }

    for (const userId of rollupKeys) {
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: getTableName(),
            Key: { userId, timestamp: ts },
            UpdateExpression:
              'SET invocationCount = if_not_exists(invocationCount, :zero) + :one, ' +
              'successCount = if_not_exists(successCount, :zero) + :success, ' +
              'totalDurationMs = if_not_exists(totalDurationMs, :zero) + :dur, ' +
              'totalInputTokens = if_not_exists(totalInputTokens, :zero) + :inTok, ' +
              'totalOutputTokens = if_not_exists(totalOutputTokens, :zero) + :outTok, ' +
              'expiresAt = :expires',
            ExpressionAttributeValues: {
              ':one': 1,
              ':success': success ? 1 : 0,
              ':zero': 0,
              ':dur': durationMs ?? 0,
              ':inTok': inputTokens ?? 0,
              ':outTok': outputTokens ?? 0,
              ':expires': expiresAt,
            },
          })
        );
      } catch (e) {
        logger.warn(`Failed to update tool token rollup for ${userId}:`, e);
      }
    }
  }

  static async getToolRollupRange(
    toolName: string,
    days: number,
    scope?: TokenScope
  ): Promise<ToolTokenRollup[]> {
    const endTs = dayStart();
    const startTs = endTs - days * TIME.SECONDS_IN_DAY * 1000;

    let userId: string;
    if (scope?.workspaceId) {
      userId = `WS#${scope.workspaceId}#TOOL_TOKEN#${toolName}`;
    } else if (scope?.teamId) {
      userId = `TEAM#${scope.teamId}#TOOL_TOKEN#${toolName}`;
    } else {
      userId = `TOOL_TOKEN#${toolName}`;
    }

    try {
      const { Items } = await docClient.send(
        new QueryCommand({
          TableName: getTableName(),
          KeyConditionExpression: 'userId = :pk AND #ts BETWEEN :start AND :end',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: {
            ':pk': userId,
            ':start': startTs,
            ':end': endTs,
          },
          ScanIndexForward: false,
        })
      );
      return (Items as ToolTokenRollup[]) ?? [];
    } catch (error) {
      logger.debug('Failed to query tool token rollup', { toolName, error });
      return [];
    }
  }
}
