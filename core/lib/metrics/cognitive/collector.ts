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

    const timestamp = Date.now();
    this.buffer.push(
      { agentId, workspaceId, name: 'task_completed', value: success ? 1 : 0, timestamp, metadata },
      { agentId, workspaceId, name: 'task_latency_ms', value: latencyMs, timestamp },
      { agentId, workspaceId, name: 'tokens_used', value: tokensUsed, timestamp }
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

    const timestamp = Date.now();
    this.buffer.push(
      { agentId, workspaceId, name: 'reasoning_coherence', value: coherenceScore, timestamp },
      { agentId, workspaceId, name: 'reasoning_steps', value: reasoningSteps, timestamp },
      { agentId, workspaceId, name: 'pivot', value: pivoted ? 1 : 0, timestamp },
      {
        agentId,
        workspaceId,
        name: 'clarification_request',
        value: requestedClarification ? 1 : 0,
        timestamp,
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

    const timestamp = Date.now();
    this.buffer.push(
      { agentId, workspaceId, name: `memory_${operation}`, value: 1, timestamp },
      { agentId, workspaceId, name: 'memory_latency_ms', value: latencyMs, timestamp }
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

    for (const metric of metricsToFlush) {
      try {
        const prefix = metric.workspaceId ? `WS#${metric.workspaceId}#` : '';
        await this.base.putItem({
          userId: `${prefix}${MEMORY_KEYS.HEALTH_PREFIX}METRIC#${metric.agentId}`,
          timestamp: metric.timestamp,
          type: 'COGNITIVE_METRIC',
          metricName: metric.name,
          value: metric.value,
          metadata: metric.metadata ?? {},
          expiresAt,
        });
      } catch (error) {
        logger.error('Failed to persist cognitive metric', { error, metric });
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
