import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../logger';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TTL_DAYS_INVOCATION = 7;
const TTL_DAYS_ROLLUP = 90;
const SECONDS_IN_DAY = 86400;

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
  const resource = Resource as { MemoryTable?: { name: string } };
  return resource?.MemoryTable?.name ?? 'MemoryTable';
}

function dayStart(ts: number = Date.now()): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function dateKey(ts: number = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export class TokenTracker {
  static async recordInvocation(
    record: Omit<TokenUsageRecord, 'userId' | 'expiresAt'>
  ): Promise<void> {
    const now = Date.now();
    const item: TokenUsageRecord = {
      ...record,
      userId: `TOKEN#${record.agentId}`,
      expiresAt: Math.floor(now / 1000) + TTL_DAYS_INVOCATION * SECONDS_IN_DAY,
    };

    try {
      await docClient.send(new PutCommand({ TableName: getTableName(), Item: item }));
    } catch (e) {
      logger.warn('Failed to record token invocation:', e);
    }
  }

  static async getInvocationHistory(agentId: string, limit = 20): Promise<TokenUsageRecord[]> {
    try {
      const { Items } = await docClient.send(
        new QueryCommand({
          TableName: getTableName(),
          KeyConditionExpression: 'userId = :pk',
          ExpressionAttributeValues: { ':pk': `TOKEN#${agentId}` },
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
    }
  ): Promise<void> {
    const ts = dayStart();
    const userId = `TOKEN_ROLLUP#${agentId}`;
    const expiresAt = Math.floor(Date.now() / 1000) + TTL_DAYS_ROLLUP * SECONDS_IN_DAY;

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
            'durationSamples = if_not_exists(durationSamples, :empty) & :sample, ' +
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
        logger.warn('Failed to update token rollup:', e);
      }
    }
  }

  static async getRollup(agentId: string, date?: string): Promise<TokenRollup | null> {
    const ts = date ? dayStart(new Date(date).getTime()) : dayStart();
    const userId = `TOKEN_ROLLUP#${agentId}`;
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

  static async getRollupRange(agentId: string, days: number): Promise<TokenRollup[]> {
    const endTs = dayStart();
    const startTs = endTs - days * SECONDS_IN_DAY * 1000;
    try {
      const { Items } = await docClient.send(
        new QueryCommand({
          TableName: getTableName(),
          KeyConditionExpression: 'userId = :pk AND #ts BETWEEN :start AND :end',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: {
            ':pk': `TOKEN_ROLLUP#${agentId}`,
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
    outputTokens?: number
  ): Promise<void> {
    const ts = dayStart();
    const userId = `TOOL_TOKEN#${toolName}#${dateKey(ts)}`;
    const expiresAt = Math.floor(Date.now() / 1000) + TTL_DAYS_ROLLUP * SECONDS_IN_DAY;

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
      logger.warn('Failed to update tool token rollup:', e);
    }
  }

  static async getToolRollupRange(toolName: string, days: number): Promise<ToolTokenRollup[]> {
    const endTs = dayStart();
    const startTs = endTs - days * SECONDS_IN_DAY * 1000;
    try {
      const { Items } = await docClient.send(
        new QueryCommand({
          TableName: getTableName(),
          KeyConditionExpression: 'userId = :pk AND #ts BETWEEN :start AND :end',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: {
            ':pk': `TOOL_TOKEN#${toolName}#`,
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
