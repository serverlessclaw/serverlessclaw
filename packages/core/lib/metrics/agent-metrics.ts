/**
 * @module AgentMetrics
 * @description Centralized service for recording and aggregating agent performance metrics
 * into multi-grain snapshots (Hourly, Daily, Task-based).
 */

import { logger } from '../logger';
import { getDocClient, getMemoryTableName } from '../utils/ddb-client';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

const docClient = getDocClient();

export enum MetricGrain {
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
  TASKS = 'TASKS',
}

export interface MetricSnapshot {
  agentId: string;
  grain: MetricGrain;
  timestamp: number;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  errorDistribution: Record<string, number>;
  promptHash: string;
  version: number;
}

/**
 * Records an execution result into temporal and volume-based snapshots.
 */
export async function recordAgentMetric(params: {
  agentId: string;
  success: boolean;
  durationMs: number;
  errorType?: string;
  promptHash?: string;
  version?: number;
  workspaceId?: string;
}): Promise<void> {
  const { agentId, success, durationMs, errorType, promptHash, version, workspaceId } = params;
  const now = Date.now();
  const tableName = getMemoryTableName();

  // Temporal Snapshots
  const hourStart = new Date(now).setUTCMinutes(0, 0, 0);
  const dayStart = new Date(now).setUTCHours(0, 0, 0, 0);

  const prefix = workspaceId ? `WS#${workspaceId}#` : '';
  const snapshots = [
    { grain: MetricGrain.HOURLY, ts: hourStart, pk: `${prefix}METRIC#HOUR#${agentId}` },
    { grain: MetricGrain.DAILY, ts: dayStart, pk: `${prefix}METRIC#DAY#${agentId}` },
  ];

  try {
    const promises = snapshots.map(async (s) => {
      const updateExpr = [
        'SET successCount = if_not_exists(successCount, :zero) + :s',
        'failureCount = if_not_exists(failureCount, :zero) + :f',
        'totalDurationMs = if_not_exists(totalDurationMs, :zero) + :d',
        'promptHash = :ph',
        'version = :v',
        'updatedAt = :now',
      ];

      const attrValues: Record<string, unknown> = {
        ':s': success ? 1 : 0,
        ':f': success ? 0 : 1,
        ':d': durationMs,
        ':ph': promptHash ?? 'unknown',
        ':v': version ?? 0,
        ':now': now,
        ':zero': 0,
      };

      const attrNames: Record<string, string> = {
        '#err': 'errorDistribution',
      };

      if (errorType) {
        updateExpr.push('#err.#e = if_not_exists(#err.#e, :zero) + :one');
        attrNames['#e'] = errorType;
        attrValues[':one'] = 1;
      }

      return docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { userId: s.pk, timestamp: s.ts },
          UpdateExpression: updateExpr.join(', '),
          ExpressionAttributeNames: attrNames,
          ExpressionAttributeValues: attrValues,
        })
      );
    });

    await Promise.all(promises);
  } catch (e) {
    logger.error(`[AgentMetrics] Failed to record metrics for ${agentId}:`, e);
  }
}
