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
  'DLQEvents',
  'EventHandlerInvoked',
  'EventHandlerDuration',
  'EventHandlerErrorDuration',
  'StorageError',
]);

async function persistToDynamoDB(metrics: MetricDatum[]): Promise<void> {
  const critical = metrics.filter((m) => CRITICAL_METRICS.has(m.MetricName));
  if (critical.length === 0) return;

  try {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const { getDocClient, getMemoryTableName } = await import('../utils/ddb-client');
    const docClient = getDocClient();

    const tableName = getMemoryTableName();
    if (!tableName) return;

    const now = Date.now();
    for (const m of critical) {
      const workspaceId = m.Dimensions?.find((d) => d.Name === 'WorkspaceId')?.Value;
      const scopePrefix = workspaceId ? `WS#${workspaceId}#` : '';

      // Unified Metrics Partition Format:
      // PK (userId): [Prefix]METRIC#[MetricName]
      // SK (timestamp): Date.now()
      // This enables efficient GSI querying via TypeTimestampIndex (type: 'METRIC')
      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            userId: `${scopePrefix}METRIC#${m.MetricName}`,
            timestamp: now + Math.random(), // Add micro-jitter to prevent collisions
            type: 'METRIC',
            metricName: m.MetricName,
            value: m.Value,
            unit: m.Unit ?? 'Count',
            dimensions: m.Dimensions,
            workspaceId,
            expiresAt: Math.floor(now / 1000) + 7 * 86400, // 7 days retention
          },
          ConditionExpression: 'attribute_not_exists(userId)',
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

  taskDispatchLatency(
    latencyMs: number,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions: Array<{ Name: string; Value: string }> = [];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'TaskDispatchLatency',
      Value: latencyMs,
      Unit: 'Milliseconds',
      Dimensions: dimensions.length > 0 ? dimensions : undefined,
    };
  },

  circuitBreakerTriggered(
    type: 'deploy' | 'recovery' | 'gap' | 'event',
    scope?: { workspaceId?: string; teamId?: string; staffId?: string },
    eventType?: string
  ): MetricDatum {
    const dimensions: Array<{ Name: string; Value: string }> = [{ Name: 'Type', Value: type }];
    if (eventType) dimensions.push({ Name: 'EventType', Value: eventType });
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'CircuitBreakerTriggered',
      Value: 1,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  rateLimitExceeded(
    eventType: string,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions: Array<{ Name: string; Value: string }> = [
      { Name: 'EventType', Value: eventType },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'RateLimitExceeded',
      Value: 1,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  mcpHubPing(opts: {
    success: boolean;
    latencyMs?: number;
    scope?: { workspaceId?: string; teamId?: string; staffId?: string };
  }): MetricDatum {
    const dimensions = [{ Name: 'Success', Value: String(opts.success) }];
    if (opts.scope?.workspaceId)
      dimensions.push({ Name: 'WorkspaceId', Value: opts.scope.workspaceId });
    if (opts.scope?.teamId) dimensions.push({ Name: 'TeamId', Value: opts.scope.teamId });
    if (opts.scope?.staffId) dimensions.push({ Name: 'StaffId', Value: opts.scope.staffId });

    return {
      MetricName: 'MCPHubPing',
      Value: opts.success ? 1 : 0,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  mcpHubLatency(
    latencyMs: number,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions: Array<{ Name: string; Value: string }> = [];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'MCPHubLatency',
      Value: latencyMs,
      Unit: 'Milliseconds',
      Dimensions: dimensions.length > 0 ? dimensions : undefined,
    };
  },

  eventBridgeEmit(
    success: boolean,
    latencyMs: number,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [{ Name: 'Success', Value: String(success) }];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'EventBridgeEmit',
      Value: latencyMs,
      Unit: 'Milliseconds',
      Dimensions: dimensions,
    };
  },

  dlqEvents(
    count: number,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions: Array<{ Name: string; Value: string }> = [];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'DLQEvents',
      Value: count,
      Unit: 'Count',
      Dimensions: dimensions.length > 0 ? dimensions : undefined,
    };
  },

  lockAcquired(
    lockId: string,
    success: boolean,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [
      { Name: 'LockId', Value: lockId },
      { Name: 'Success', Value: String(success) },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'LockAcquisition',
      Value: success ? 1 : 0,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  deploymentStarted(scope?: {
    workspaceId?: string;
    teamId?: string;
    staffId?: string;
  }): MetricDatum {
    const dimensions: Array<{ Name: string; Value: string }> = [];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'DeploymentStarted',
      Value: 1,
      Unit: 'Count',
      Dimensions: dimensions.length > 0 ? dimensions : undefined,
    };
  },

  deploymentCompleted(opts: {
    success: boolean;
    scope?: { workspaceId?: string; teamId?: string; staffId?: string };
  }): MetricDatum {
    const dimensions = [{ Name: 'Success', Value: String(opts.success) }];
    if (opts.scope?.workspaceId)
      dimensions.push({ Name: 'WorkspaceId', Value: opts.scope.workspaceId });
    if (opts.scope?.teamId) dimensions.push({ Name: 'TeamId', Value: opts.scope.teamId });
    if (opts.scope?.staffId) dimensions.push({ Name: 'StaffId', Value: opts.scope.staffId });

    return {
      MetricName: 'DeploymentCompleted',
      Value: 1,
      Unit: 'Count',
      Dimensions: dimensions,
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

  protocolFallback(
    agentId: string,
    originalMode: string,
    fallbackMode?: string,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [
      { Name: 'AgentId', Value: agentId },
      { Name: 'OriginalMode', Value: originalMode },
      { Name: 'FallbackMode', Value: fallbackMode ?? 'none' },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'ProtocolFallback',
      Value: 1,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  // Event handler specific metrics
  eventHandlerInvoked(
    eventType: string,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [{ Name: 'EventType', Value: eventType }];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'EventHandlerInvoked',
      Value: 1,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  eventHandlerDuration(
    eventType: string,
    durationMs: number,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [{ Name: 'EventType', Value: eventType }];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'EventHandlerDuration',
      Value: durationMs,
      Unit: 'Milliseconds',
      Dimensions: dimensions,
    };
  },

  eventHandlerErrorDuration(
    eventType: string,
    durationMs: number,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [{ Name: 'EventType', Value: eventType }];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'EventHandlerErrorDuration',
      Value: durationMs,
      Unit: 'Milliseconds',
      Dimensions: dimensions,
    };
  },

  // Swarm / Parallel execution metrics
  swarmDecomposed(
    agentId: string,
    subTaskCount: number,
    depth: number,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [
      { Name: 'AgentId', Value: agentId },
      { Name: 'Depth', Value: String(depth) },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'SwarmDecomposed',
      Value: subTaskCount,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  parallelDispatchCompleted(
    traceId: string,
    taskCount: number,
    successCount: number,
    overallStatus: string,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [
      { Name: 'TraceId', Value: traceId },
      { Name: 'OverallStatus', Value: overallStatus },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.teamId) dimensions.push({ Name: 'TeamId', Value: scope.teamId });
    if (scope?.staffId) dimensions.push({ Name: 'StaffId', Value: scope.staffId });

    return {
      MetricName: 'ParallelDispatchCompleted',
      Value: successCount,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  storageError(
    operation: string,
    errorName: string,
    tableName: string,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): MetricDatum {
    const dimensions = [
      { Name: 'Operation', Value: operation },
      { Name: 'ErrorName', Value: errorName },
      { Name: 'TableName', Value: tableName },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });

    return {
      MetricName: 'StorageError',
      Value: 1,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },

  configAccessed(
    key: string,
    operation: 'get' | 'set' | 'delete' | 'increment',
    scope?: { workspaceId?: string; orgId?: string }
  ): MetricDatum {
    const dimensions = [
      { Name: 'Key', Value: key },
      { Name: 'Operation', Value: operation },
    ];
    if (scope?.workspaceId) dimensions.push({ Name: 'WorkspaceId', Value: scope.workspaceId });
    if (scope?.orgId) dimensions.push({ Name: 'OrgId', Value: scope.orgId });

    return {
      MetricName: 'ConfigAccess',
      Value: 1,
      Unit: 'Count',
      Dimensions: dimensions,
    };
  },
};
