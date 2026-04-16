import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../logger';
import { MEMORY_KEYS } from '../../constants';
import { BaseMemoryProvider } from '../../memory/base';
import { DynamoMemory } from '../../memory/dynamo-memory';
import { SSTResource } from '../../types/system';

/**
 * Silo 5: The Eye - Observation & Consistency Probe
 * Verifies that the internal system state matches reported metrics
 * and that no signal drift has occurred between backend and dashboard.
 */
export class ConsistencyProbe {
  private base: BaseMemoryProvider;

  constructor(base: BaseMemoryProvider) {
    this.base = base;
  }

  /**
   * Run a consistency check for a specific agent's traces.
   * Compares raw trace counts in DynamoDB with the aggregated metrics.
   */
  async verifyTraceConsistency(
    agentId: string,
    windowStart: number,
    windowEnd: number
  ): Promise<{
    consistent: boolean;
    drift: number;
    details: string;
  }> {
    // 1. Fetch all metrics for the agent in this window in ONE query
    const allMetrics = await this.base.queryItems({
      KeyConditionExpression: 'userId = :pk AND #ts BETWEEN :start AND :end',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pk': `${MEMORY_KEYS.HEALTH_PREFIX}METRIC#${agentId}`,
        ':start': windowStart,
        ':end': windowEnd,
      },
    });

    // 2. Count metrics by name in memory
    const counts = allMetrics.reduce(
      (acc: Record<string, number>, item: { metricName?: string }) => {
        const name = (item.metricName as string) || 'unknown';
        acc[name] = (acc[name] || 0) + 1;
        return acc;
      },
      {}
    );

    const metricsCount = counts['task_completed'] || 0;
    const latencyCount = counts['task_latency_ms'] || 0;
    const internalDrift = Math.abs(metricsCount - latencyCount);

    // 3. Cross-reference with TraceTable for end-to-end verification
    const traceCount = await this.getTraceCountFromTable(agentId, windowStart, windowEnd);
    const traceDrift = traceCount > 0 ? Math.abs(metricsCount - traceCount) : 0;
    const totalDrift = internalDrift + traceDrift;

    return {
      consistent: totalDrift === 0,
      drift: totalDrift,
      details: this.buildConsistencyDetails(
        metricsCount,
        latencyCount,
        traceCount,
        internalDrift,
        traceDrift
      ),
    };
  }

  /**
   * Query TraceTable for actual trace counts within the time window using AgentIdIndex GSI.
   */
  private async getTraceCountFromTable(
    agentId: string,
    windowStart: number,
    windowEnd: number
  ): Promise<number> {
    try {
      const typedResource = Resource as unknown as SSTResource;
      const tableName = typedResource.TraceTable?.name;
      if (!tableName) return 0;

      const client = new DynamoDBClient({});
      const docClient = DynamoDBDocumentClient.from(client, {
        marshallOptions: { removeUndefinedValues: true },
      });

      const response = await docClient.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'AgentIdIndex',
          KeyConditionExpression: 'agentId = :agentId AND #ts BETWEEN :start AND :end',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: {
            ':agentId': agentId,
            ':start': windowStart,
            ':end': windowEnd,
          },
          Select: 'COUNT',
        })
      );

      return response.Count ?? 0;
    } catch (e) {
      logger.debug('[Probe] Failed to query TraceTable cross-reference:', e);
      return 0;
    }
  }

  /**
   * Build human-readable consistency details.
   */
  private buildConsistencyDetails(
    metricsCount: number,
    latencyCount: number,
    traceCount: number,
    internalDrift: number,
    traceDrift: number
  ): string {
    const parts: string[] = [];

    if (internalDrift === 0) {
      parts.push(`Internal metrics consistent (${metricsCount} completions)`);
    } else {
      parts.push(
        `INTERNAL DRIFT: ${internalDrift} (completions: ${metricsCount}, latency records: ${latencyCount})`
      );
    }

    if (traceCount > 0) {
      if (traceDrift === 0) {
        parts.push(`TraceTable verified (${traceCount} traces)`);
      } else {
        parts.push(
          `TRACE DRIFT: ${traceDrift} (metrics: ${metricsCount}, actual traces: ${traceCount})`
        );
      }
    } else {
      parts.push('TraceTable cross-reference unavailable');
    }

    return parts.join('. ');
  }

  /**
   * Static helper for quick drift detection.
   */
  static async detectDrift(agentId: string, memory?: BaseMemoryProvider): Promise<boolean> {
    const provider = memory ?? new DynamoMemory();
    const probe = new ConsistencyProbe(provider);
    const now = Date.now();
    const result = await probe.verifyTraceConsistency(agentId, now - 3600000, now);

    if (!result.consistent && result.drift > 0) {
      logger.warn(`[Eye] Signal drift detected for agent ${agentId}: ${result.details}`);

      try {
        const { emitEvent } = await import('../../utils/bus');
        const { AgentType, EventType, TraceSource } = await import('../../types/agent');
        await emitEvent(AgentType.RECOVERY, EventType.DASHBOARD_FAILURE_DETECTED, {
          userId: 'SYSTEM',
          traceId: `drift-${agentId}-${now}`,
          agentId,
          task: 'Consistency Check',
          error: `SIGNAL_DRIFT: ${result.details}`,
          metadata: { drift: result.drift, windowMs: 3600000 },
          source: TraceSource.SYSTEM,
        });
      } catch (e) {
        logger.debug('[Probe] Failed to emit drift event:', e);
      }
    } else if (result.drift === 0) {
      logger.info(`[Eye] Trace consistency verified for agent ${agentId}`);
    }

    return !result.consistent;
  }
}
