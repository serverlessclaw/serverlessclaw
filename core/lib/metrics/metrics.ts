/**
 * CloudWatch Metrics Module
 *
 * Provides custom metrics for monitoring agent performance, tool execution,
 * and system health. Metrics are emitted to CloudWatch for alerting and dashboards.
 *
 * NOTE: Requires @aws-sdk/client-cloudwatch to be installed for actual CloudWatch emission.
 * If not available, metrics are logged to console for debugging.
 * CRITICAL metrics are also persisted to DynamoDB as fallback for durable observability.
 */

const NAMESPACE = 'ServerlessClaw';

interface CloudWatchClientType {
  send: (command: unknown) => Promise<unknown>;
}

let cloudwatch: CloudWatchClientType | null = null;

async function getCloudWatchClient(): Promise<CloudWatchClientType | null> {
  if (cloudwatch) return cloudwatch;

  try {
    const { CloudWatchClient } = await import('@aws-sdk/client-cloudwatch');
    cloudwatch = new CloudWatchClient({}) as CloudWatchClientType;
    return cloudwatch;
  } catch {
    return null;
  }
}

const CRITICAL_METRICS = new Set([
  'AgentInvocations',
  'AgentDuration',
  'DeploymentStarted',
  'DeploymentCompleted',
  'CircuitBreakerTriggered',
  'RateLimitExceeded',
]);

async function persistToDynamoDB(metrics: MetricDatum[]): Promise<void> {
  const critical = metrics.filter((m) => CRITICAL_METRICS.has(m.MetricName));
  if (critical.length === 0) return;

  try {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const { getDocClient, getConfigTableName } = await import('../utils/ddb-client');
    const docClient = getDocClient();

    const tableName = getConfigTableName();
    if (!tableName) return;

    const now = Date.now();
    for (const m of critical) {
      const workspaceId = m.Dimensions?.find((d) => d.Name === 'WorkspaceId')?.Value;
      const scopePrefix = workspaceId ? `WS#${workspaceId}#` : '';

      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: `${scopePrefix}METRIC#${m.MetricName}#${now}#${Math.random().toString(36).slice(2, 8)}`,
            metricName: m.MetricName,
            value: m.Value,
            unit: m.Unit ?? 'Count',
            dimensions: m.Dimensions,
            workspaceId,
            timestamp: now,
            expiresAt: Math.floor(now / 1000) + 7 * 86400, // 7 days retention
          },
        })
      );
    }
  } catch (e) {
    // Only use console if logger import fails, otherwise use logger
    try {
      const { logger } = await import('../logger');
      logger.error('[METRICS] Critical DynamoDB fallback failed', {
        error: e,
        metricCount: critical.length,
      });
    } catch {
      // Last resort fallback
      const { logger } = await import('../logger');
      logger.error('[METRICS] DynamoDB fallback failed and logger unavailable:', e);
    }
  }
}

export interface MetricDatum {
  MetricName: string;
  Value: number;
  Unit?: 'Count' | 'Milliseconds' | 'Seconds';
  Dimensions?: Array<{ Name: string; Value: string }>;
}

export async function emitMetrics(metrics: MetricDatum[]): Promise<void> {
  if (metrics.length === 0) return;

  const cw = await getCloudWatchClient();
  if (!cw) {
    const { logger } = await import('../logger');
    logger.warn('[METRICS] CloudWatch not available, persisting critical metrics to DynamoDB');
    await persistToDynamoDB(metrics);
    return;
  }

  try {
    const { PutMetricDataCommand } = await import('@aws-sdk/client-cloudwatch');
    const command = new PutMetricDataCommand({
      Namespace: NAMESPACE,
      MetricData: metrics.map((m) => ({
        MetricName: m.MetricName,
        Value: m.Value,
        Unit: m.Unit ?? 'Count',
        Dimensions: m.Dimensions,
        Timestamp: new Date(),
      })),
    });
    await cw.send(command);
  } catch (error) {
    const { logger } = await import('../logger');
    logger.error('[METRICS] Failed to emit CloudWatch metrics, falling back to DynamoDB', {
      error,
    });
    await persistToDynamoDB(metrics);
  }
}

export const METRICS = {
  agentInvoked(
    agentId: string,
    success: boolean = true,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [
      { Name: 'AgentId', Value: agentId },
      { Name: 'Success', Value: success ? 'true' : 'false' },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'AgentInvocations',
      Value: 1,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  agentDuration(
    agentId: string,
    durationMs: number,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [{ Name: 'AgentId', Value: agentId }];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'AgentDuration',
      Value: durationMs,
      Unit: 'Milliseconds',
      Dimensions: dimensions,
    };
  },

  toolExecuted(
    toolName: string,
    success: boolean,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [
      { Name: 'ToolName', Value: toolName },
      { Name: 'Success', Value: String(success) },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'ToolExecutions',
      Value: 1,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  toolDuration(
    toolName: string,
    durationMs: number,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [{ Name: 'ToolName', Value: toolName }];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'ToolDuration',
      Value: durationMs,
      Unit: 'Milliseconds',
      Dimensions: dimensions,
    };
  },

  taskDispatchLatency(latencyMs: number): MetricDatum {
    return {
      MetricName: 'TaskDispatchLatency',
      Value: latencyMs,
      Unit: 'Milliseconds',
    };
  },

  circuitBreakerTriggered(type: 'deploy' | 'recovery' | 'gap' | 'event'): MetricDatum {
    return {
      MetricName: 'CircuitBreakerTriggered',
      Value: 1,
      Unit: 'Count',
      Dimensions: [{ Name: 'Type', Value: type }],
    };
  },

  rateLimitExceeded(eventType: string): MetricDatum {
    return {
      MetricName: 'RateLimitExceeded',
      Value: 1,
      Unit: 'Count',
      Dimensions: [{ Name: 'EventType', Value: eventType }],
    };
  },

  mcpHubPing(opts: { success: boolean; latencyMs?: number }): MetricDatum {
    return {
      MetricName: 'MCPHubPing',
      Value: opts.success ? 1 : 0,
      Unit: 'Count',
      Dimensions: [{ Name: 'Success', Value: String(opts.success) }],
    };
  },

  mcpHubLatency(latencyMs: number): MetricDatum {
    return {
      MetricName: 'MCPHubLatency',
      Value: latencyMs,
      Unit: 'Milliseconds',
    };
  },

  eventBridgeEmit(success: boolean, latencyMs: number): MetricDatum {
    return {
      MetricName: 'EventBridgeEmit',
      Value: latencyMs,
      Unit: 'Milliseconds',
      Dimensions: [{ Name: 'Success', Value: String(success) }],
    };
  },

  dlqEvents(count: number): MetricDatum {
    return {
      MetricName: 'DLQEvents',
      Value: count,
      Unit: 'Count',
    };
  },

  lockAcquired(lockId: string, success: boolean): MetricDatum {
    return {
      MetricName: 'LockAcquisition',
      Value: success ? 1 : 0,
      Unit: 'Count',
      Dimensions: [{ Name: 'LockId', Value: lockId }],
    };
  },

  deploymentStarted(): MetricDatum {
    return {
      MetricName: 'DeploymentStarted',
      Value: 1,
      Unit: 'Count',
    };
  },

  deploymentCompleted(opts: { success: boolean }): MetricDatum {
    return {
      MetricName: 'DeploymentCompleted',
      Value: 1,
      Unit: 'Count',
      Dimensions: [{ Name: 'Success', Value: String(opts.success) }],
    };
  },

  tokensInput(
    inputTokens: number,
    agentId: string,
    provider: string,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [
      { Name: 'AgentId', Value: agentId },
      { Name: 'Provider', Value: provider },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'TokensInput',
      Value: inputTokens,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  tokensOutput(
    outputTokens: number,
    agentId: string,
    provider: string,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [
      { Name: 'AgentId', Value: agentId },
      { Name: 'Provider', Value: provider },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'TokensOutput',
      Value: outputTokens,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  protocolFallback(agentId: string, originalMode: string, fallbackMode?: string): MetricDatum {
    return {
      MetricName: 'ProtocolFallback',
      Value: 1,
      Unit: 'Count',
      Dimensions: [
        { Name: 'AgentId', Value: agentId },
        { Name: 'OriginalMode', Value: originalMode },
        { Name: 'FallbackMode', Value: fallbackMode ?? 'none' },
      ],
    };
  },

  // Event handler specific metrics
  eventHandlerInvoked(eventType: string): MetricDatum {
    return {
      MetricName: 'EventHandlerInvoked',
      Value: 1,
      Unit: 'Count',
      Dimensions: [{ Name: 'EventType', Value: eventType }],
    };
  },

  eventHandlerDuration(eventType: string, durationMs: number): MetricDatum {
    return {
      MetricName: 'EventHandlerDuration',
      Value: durationMs,
      Unit: 'Milliseconds',
      Dimensions: [{ Name: 'EventType', Value: eventType }],
    };
  },

  eventHandlerErrorDuration(eventType: string, durationMs: number): MetricDatum {
    return {
      MetricName: 'EventHandlerErrorDuration',
      Value: durationMs,
      Unit: 'Milliseconds',
      Dimensions: [{ Name: 'EventType', Value: eventType }],
    };
  },
};
