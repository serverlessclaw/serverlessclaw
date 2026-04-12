/**
 * CloudWatch Metrics Module
 *
 * Provides custom metrics for monitoring agent performance, tool execution,
 * and system health. Metrics are emitted to CloudWatch for alerting and dashboards.
 *
 * NOTE: Requires @aws-sdk/client-cloudwatch to be installed for actual CloudWatch emission.
 * If not available, metrics are logged to console for debugging.
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
    // CloudWatch SDK unavailable in test/local environments
    return null;
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
    console.warn('[METRICS] CloudWatch not available, metrics dropped:', metrics.length, 'items');
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
    console.error('[METRICS] Failed to emit CloudWatch metrics:', error);
  }
}

export const METRICS = {
  agentInvoked(agentId: string): MetricDatum {
    return {
      MetricName: 'AgentInvocations',
      Value: 1,
      Unit: 'Count',
      Dimensions: [{ Name: 'AgentId', Value: agentId }],
    };
  },

  agentDuration(agentId: string, durationMs: number): MetricDatum {
    return {
      MetricName: 'AgentDuration',
      Value: durationMs,
      Unit: 'Milliseconds',
      Dimensions: [{ Name: 'AgentId', Value: agentId }],
    };
  },

  toolExecuted(toolName: string, success: boolean): MetricDatum {
    return {
      MetricName: 'ToolExecutions',
      Value: 1,
      Unit: 'Count',
      Dimensions: [
        { Name: 'ToolName', Value: toolName },
        { Name: 'Success', Value: String(success) },
      ],
    };
  },

  toolDuration(toolName: string, durationMs: number): MetricDatum {
    return {
      MetricName: 'ToolDuration',
      Value: durationMs,
      Unit: 'Milliseconds',
      Dimensions: [{ Name: 'ToolName', Value: toolName }],
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

  tokensInput(inputTokens: number, agentId: string, provider: string): MetricDatum {
    return {
      MetricName: 'TokensInput',
      Value: inputTokens,
      Unit: 'Count',
      Dimensions: [
        { Name: 'AgentId', Value: agentId },
        { Name: 'Provider', Value: provider },
      ],
    };
  },

  tokensOutput(outputTokens: number, agentId: string, provider: string): MetricDatum {
    return {
      MetricName: 'TokensOutput',
      Value: outputTokens,
      Unit: 'Count',
      Dimensions: [
        { Name: 'AgentId', Value: agentId },
        { Name: 'Provider', Value: provider },
      ],
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
