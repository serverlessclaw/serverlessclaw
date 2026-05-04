import { logger } from '../../logger';
import { MEMORY_KEYS, TIME } from '../../constants';
import { BaseMemoryProvider } from '../../memory/base';
import { CognitiveMetric, CognitiveMetricsConfig } from '../../types/metrics';

export const DEFAULT_CONFIG: CognitiveMetricsConfig = {
  enabled: true,
  retentionDays: 30, // Default fallback
  thresholds: {
    minCompletionRate: 0.7,
    maxErrorRate: 0.3,
    minCoherence: 5.0,
    maxMissRate: 0.5,
    maxAvgLatencyMs: 15000,
    maxPivotRate: 0.2,
    minSampleTasks: 10,
  },
};

/**
 * Collects cognitive metrics during agent operations.
 */
export class MetricsCollector {
  private base: BaseMemoryProvider;
  private config: CognitiveMetricsConfig;
  private buffer: CognitiveMetric[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(base: BaseMemoryProvider, config?: Partial<CognitiveMetricsConfig>) {
    this.base = base;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the auto-flush interval.
   */
  start(): void {
    if (this.config.enabled && !this.flushInterval) {
      this.flushInterval = setInterval(() => this.flush(), 10000);
      if (
        this.flushInterval &&
        typeof this.flushInterval === 'object' &&
        'unref' in this.flushInterval
      ) {
        (this.flushInterval as NodeJS.Timeout).unref();
      }
    }
  }

  /**
   * Record a task completion event.
   */
  async recordTaskCompletion(
    agentId: string,
    success: boolean,
    latencyMs: number,
    tokensUsed: number,
    metadata?: Record<string, unknown>,
    workspaceId?: string
  ): Promise<void> {
    if (!this.config.enabled) return;

    const baseTimestamp = Date.now();
    this.buffer.push(
      {
        agentId,
        workspaceId,
        name: 'task_completed',
        value: success ? 1 : 0,
        timestamp: baseTimestamp,
        metadata,
      },
      {
        agentId,
        workspaceId,
        name: 'task_latency_ms',
        value: latencyMs,
        timestamp: baseTimestamp + 0.001,
      },
      {
        agentId,
        workspaceId,
        name: 'tokens_used',
        value: tokensUsed,
        timestamp: baseTimestamp + 0.002,
      }
    );

    const MAX_BUFFER_SIZE = 200;
    if (!success || this.buffer.length > 50) {
      if (this.buffer.length >= MAX_BUFFER_SIZE) {
        this.buffer = this.buffer.slice(-MAX_BUFFER_SIZE);
        logger.warn(
          `[MetricsCollector] Buffer exceeded max size ${MAX_BUFFER_SIZE}, trimming oldest entries`
        );
      }
      await this.flush();
    }
  }

  /**
   * Record reasoning quality assessment.
   */
  async recordReasoningQuality(
    agentId: string,
    coherenceScore: number,
    reasoningSteps: number,
    pivoted: boolean,
    requestedClarification: boolean,
    workspaceId?: string
  ): Promise<void> {
    if (!this.config.enabled) return;

    const baseTimestamp = Date.now();
    this.buffer.push(
      {
        agentId,
        workspaceId,
        name: 'reasoning_coherence',
        value: coherenceScore,
        timestamp: baseTimestamp,
      },
      {
        agentId,
        workspaceId,
        name: 'reasoning_steps',
        value: reasoningSteps,
        timestamp: baseTimestamp + 0.001,
      },
      {
        agentId,
        workspaceId,
        name: 'pivot',
        value: pivoted ? 1 : 0,
        timestamp: baseTimestamp + 0.002,
      },
      {
        agentId,
        workspaceId,
        name: 'clarification_request',
        value: requestedClarification ? 1 : 0,
        timestamp: baseTimestamp + 0.003,
      }
    );
  }

  /**
   * Record a self-correction event.
   */
  async recordSelfCorrection(agentId: string, workspaceId?: string): Promise<void> {
    if (!this.config.enabled) return;
    const timestamp = Date.now();
    this.buffer.push({ agentId, workspaceId, name: 'self_correction', value: 1, timestamp });
  }

  /**
   * Record memory operation metrics.
   */
  async recordMemoryOperation(
    agentId: string,
    operation: 'read' | 'write' | 'hit' | 'miss',
    latencyMs: number,
    workspaceId?: string
  ): Promise<void> {
    if (!this.config.enabled) return;

    const baseTimestamp = Date.now();
    this.buffer.push(
      { agentId, workspaceId, name: `memory_${operation}`, value: 1, timestamp: baseTimestamp },
      {
        agentId,
        workspaceId,
        name: 'memory_latency_ms',
        value: latencyMs,
        timestamp: baseTimestamp + 0.001,
      }
    );
  }

  /**
   * Flush buffered metrics to persistent storage.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const metricsToFlush = [...this.buffer];
    this.buffer = [];

    const expiresAt = Math.floor((Date.now() + this.config.retentionDays * TIME.MS_PER_DAY) / 1000);

    // Sh6 Fix: Ensure unique timestamps within this flush to prevent DynamoDB SK collisions
    // We use a counter added to the base timestamp to guarantee uniqueness.
    let globalCounter = 0;

    for (const metric of metricsToFlush) {
      let success = false;
      let attempts = 0;
      const maxAttempts = 3;

      while (!success && attempts < maxAttempts) {
        try {
          const prefix = metric.workspaceId ? `WS#${metric.workspaceId}#` : '';
          const pk = `${prefix}${MEMORY_KEYS.HEALTH_PREFIX}METRIC#${metric.agentId}`;

          // Add a tiny fractional increment + jitter to guarantee uniqueness
          const ts = metric.timestamp + globalCounter * 0.00001 + Math.random() * 0.000001;
          globalCounter++;

          await this.base.putItem(
            {
              userId: pk,
              timestamp: ts,
              type: 'COGNITIVE_METRIC',
              metricName: metric.name,
              value: metric.value,
              metadata: metric.metadata ?? {},
              expiresAt,
            },
            {
              ConditionExpression: 'attribute_not_exists(userId)',
            }
          );
          success = true;
        } catch (error) {
          if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
            attempts++;
            // Slightly back off and retry with a new timestamp jitter
            await new Promise((r) => setTimeout(r, 10));
          } else {
            logger.error('Failed to persist cognitive metric', { error, metric });
            break;
          }
        }
      }

      if (!success && attempts >= maxAttempts) {
        logger.error('Failed to persist cognitive metric after max attempts due to collisions', {
          metric,
        });
      }
    }

    logger.debug(`Flushed ${metricsToFlush.length} cognitive metrics`);
  }

  /**
   * Cleanup on shutdown.
   */
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush().catch((err) => logger.error('Failed to flush metrics on destroy', err));
  }
}
