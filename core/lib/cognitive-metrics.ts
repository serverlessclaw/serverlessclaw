/**
 * @module CognitiveMetrics
 * @description Deep cognitive health monitoring for Serverless Claw.
 * Tracks agent reasoning quality, memory health, and cognitive degradation
 * to enable proactive system optimization and anomaly detection.
 */

import { logger } from './logger';
import { MEMORY_KEYS, RETENTION, TIME } from './constants';
import type { BaseMemoryProvider } from './memory/base';

/**
 * Time windows for metrics aggregation.
 */
export enum MetricsWindow {
  HOURLY = 'hourly',
  DAILY = 'daily',
  WEEKLY = 'weekly',
}

/**
 * Anomaly severity levels.
 */
export enum AnomalySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Types of cognitive anomalies.
 */
export enum AnomalyType {
  REASONING_DEGRADATION = 'reasoning_degradation',
  MEMORY_FRAGMENTATION = 'memory_fragmentation',
  TASK_FAILURE_SPIKE = 'task_failure_spike',
  LATENCY_ANOMALY = 'latency_anomaly',
  TOKEN_OVERUSE = 'token_overuse',
  COGNITIVE_LOOP = 'cognitive_loop',
}

/**
 * Individual cognitive metric data point.
 */
export interface CognitiveMetric {
  /** Agent ID this metric belongs to. */
  agentId: string;
  /** Metric name (e.g., 'task_completion_rate', 'reasoning_coherence'). */
  name: string;
  /** Numeric value of the metric. */
  value: number;
  /** Timestamp when metric was recorded. */
  timestamp: number;
  /** Optional metadata for the metric. */
  metadata?: Record<string, unknown>;
}

/**
 * Aggregated metrics for a time window.
 */
export interface AggregatedMetrics {
  /** Agent ID. */
  agentId: string;
  /** Time window. */
  window: MetricsWindow;
  /** Window start timestamp. */
  windowStart: number;
  /** Window end timestamp. */
  windowEnd: number;
  /** Task completion rate (0-1). */
  taskCompletionRate: number;
  /** Average task latency in ms. */
  avgTaskLatencyMs: number;
  /** Reasoning coherence score (0-10). */
  reasoningCoherence: number;
  /** Memory hit rate (0-1). */
  memoryHitRate: number;
  /** Memory fragmentation score (0-1, lower is better). */
  memoryFragmentation: number;
  /** Token efficiency (tasks per 1000 tokens). */
  tokenEfficiency: number;
  /** Error rate (0-1). */
  errorRate: number;
  /** Total tasks processed. */
  totalTasks: number;
  /** Total tokens consumed. */
  totalTokens: number;
}

/**
 * Detected cognitive anomaly.
 */
export interface CognitiveAnomaly {
  /** Unique anomaly ID. */
  id: string;
  /** Type of anomaly. */
  type: AnomalyType;
  /** Severity level. */
  severity: AnomalySeverity;
  /** Agent ID where anomaly was detected. */
  agentId: string;
  /** Timestamp of detection. */
  detectedAt: number;
  /** Human-readable description. */
  description: string;
  /** Metric values that triggered the anomaly. */
  triggerMetrics: Record<string, number>;
  /** Suggested remediation. */
  suggestion?: string;
}

/**
 * Memory health analysis result.
 */
export interface MemoryHealthAnalysis {
  /** Total memory items. */
  totalItems: number;
  /** Items by tier. */
  itemsByTier: Record<string, number>;
  /** Average item age in days. */
  avgAgeDays: number;
  /** Staleness score (0-1, higher means more stale). */
  stalenessScore: number;
  /** Fragmentation score (0-1, higher means more fragmented). */
  fragmentationScore: number;
  /** Coverage score (0-1, how well memory covers known topics). */
  coverageScore: number;
  /** Recommended actions. */
  recommendations: string[];
}

/**
 * Reasoning quality metrics.
 */
export interface ReasoningQualityMetrics {
  /** Coherence score (0-10, higher is better). */
  coherenceScore: number;
  /** Task completion success rate (0-1). */
  completionRate: number;
  /** Average reasoning steps per task. */
  avgReasoningSteps: number;
  /** Pivot rate (how often agent changes approach). */
  pivotRate: number;
  /** Clarification request rate. */
  clarificationRate: number;
  /** Self-correction rate. */
  selfCorrectionRate: number;
}

/**
 * Cognitive health snapshot combining all metrics.
 */
export interface CognitiveHealthSnapshot {
  /** Timestamp of snapshot. */
  timestamp: number;
  /** Overall health score (0-100). */
  overallScore: number;
  /** Reasoning quality metrics. */
  reasoning: ReasoningQualityMetrics;
  /** Memory health analysis. */
  memory: MemoryHealthAnalysis;
  /** Recent anomalies. */
  anomalies: CognitiveAnomaly[];
  /** Aggregated metrics for each agent. */
  agentMetrics: AggregatedMetrics[];
}

/**
 * Configuration for cognitive metrics collection.
 */
export interface CognitiveMetricsConfig {
  /** Enable metrics collection. */
  enabled: boolean;
  /** Retention days for raw metrics. */
  retentionDays: number;
  /** Anomaly detection thresholds. */
  thresholds: {
    /** Minimum task completion rate before alerting. */
    minCompletionRate: number;
    /** Maximum error rate before alerting. */
    maxErrorRate: number;
    /** Minimum reasoning coherence before alerting. */
    minCoherence: number;
    /** Maximum memory fragmentation before alerting. */
    maxFragmentation: number;
  };
}

const DEFAULT_CONFIG: CognitiveMetricsConfig = {
  enabled: true,
  retentionDays: RETENTION.HEALTH_DAYS,
  thresholds: {
    minCompletionRate: 0.7,
    maxErrorRate: 0.3,
    minCoherence: 5.0,
    maxFragmentation: 0.7,
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

    // Auto-flush buffer every 60 seconds
    if (this.config.enabled) {
      this.flushInterval = setInterval(() => this.flush(), 60000);
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
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.config.enabled) return;

    const timestamp = Date.now();
    this.buffer.push(
      { agentId, name: 'task_completed', value: success ? 1 : 0, timestamp, metadata },
      { agentId, name: 'task_latency_ms', value: latencyMs, timestamp },
      { agentId, name: 'tokens_used', value: tokensUsed, timestamp }
    );

    // Flush if buffer is large
    if (this.buffer.length > 100) {
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
    requestedClarification: boolean
  ): Promise<void> {
    if (!this.config.enabled) return;

    const timestamp = Date.now();
    this.buffer.push(
      { agentId, name: 'reasoning_coherence', value: coherenceScore, timestamp },
      { agentId, name: 'reasoning_steps', value: reasoningSteps, timestamp },
      { agentId, name: 'pivot', value: pivoted ? 1 : 0, timestamp },
      { agentId, name: 'clarification_request', value: requestedClarification ? 1 : 0, timestamp }
    );
  }

  /**
   * Record memory operation metrics.
   */
  async recordMemoryOperation(
    agentId: string,
    operation: 'read' | 'write' | 'hit' | 'miss',
    latencyMs: number
  ): Promise<void> {
    if (!this.config.enabled) return;

    const timestamp = Date.now();
    this.buffer.push(
      { agentId, name: `memory_${operation}`, value: 1, timestamp },
      { agentId, name: 'memory_latency_ms', value: latencyMs, timestamp }
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
        await this.base.putItem({
          userId: `${MEMORY_KEYS.HEALTH_PREFIX}METRIC#${metric.agentId}`,
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

/**
 * Detects cognitive anomalies from metrics.
 */
export class DegradationDetector {
  private config: CognitiveMetricsConfig;

  constructor(config?: Partial<CognitiveMetricsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze aggregated metrics for anomalies.
   */
  detectAnomalies(agentId: string, metrics: AggregatedMetrics): CognitiveAnomaly[] {
    const anomalies: CognitiveAnomaly[] = [];
    const now = Date.now();

    // Check task completion rate
    if (metrics.taskCompletionRate < this.config.thresholds.minCompletionRate) {
      anomalies.push({
        id: `anomaly_${now}_${Math.random().toString(36).substr(2, 9)}`,
        type: AnomalyType.TASK_FAILURE_SPIKE,
        severity:
          metrics.taskCompletionRate < 0.5 ? AnomalySeverity.CRITICAL : AnomalySeverity.HIGH,
        agentId,
        detectedAt: now,
        description: `Task completion rate dropped to ${(metrics.taskCompletionRate * 100).toFixed(1)}%`,
        triggerMetrics: { taskCompletionRate: metrics.taskCompletionRate },
        suggestion: 'Review recent task failures and check for configuration issues',
      });
    }

    // Check error rate
    if (metrics.errorRate > this.config.thresholds.maxErrorRate) {
      anomalies.push({
        id: `anomaly_${now}_${Math.random().toString(36).substr(2, 9)}`,
        type: AnomalyType.TASK_FAILURE_SPIKE,
        severity: metrics.errorRate > 0.5 ? AnomalySeverity.CRITICAL : AnomalySeverity.HIGH,
        agentId,
        detectedAt: now,
        description: `Error rate elevated to ${(metrics.errorRate * 100).toFixed(1)}%`,
        triggerMetrics: { errorRate: metrics.errorRate },
        suggestion: 'Check error logs and consider rolling back recent changes',
      });
    }

    // Check reasoning coherence
    if (metrics.reasoningCoherence < this.config.thresholds.minCoherence) {
      anomalies.push({
        id: `anomaly_${now}_${Math.random().toString(36).substr(2, 9)}`,
        type: AnomalyType.REASONING_DEGRADATION,
        severity:
          metrics.reasoningCoherence < 3 ? AnomalySeverity.CRITICAL : AnomalySeverity.MEDIUM,
        agentId,
        detectedAt: now,
        description: `Reasoning coherence dropped to ${metrics.reasoningCoherence.toFixed(1)}/10`,
        triggerMetrics: { reasoningCoherence: metrics.reasoningCoherence },
        suggestion: 'Review agent prompts and consider model upgrade',
      });
    }

    // Check memory fragmentation
    if (metrics.memoryFragmentation > this.config.thresholds.maxFragmentation) {
      anomalies.push({
        id: `anomaly_${now}_${Math.random().toString(36).substr(2, 9)}`,
        type: AnomalyType.MEMORY_FRAGMENTATION,
        severity: metrics.memoryFragmentation > 0.9 ? AnomalySeverity.HIGH : AnomalySeverity.MEDIUM,
        agentId,
        detectedAt: now,
        description: `Memory fragmentation at ${(metrics.memoryFragmentation * 100).toFixed(1)}%`,
        triggerMetrics: { memoryFragmentation: metrics.memoryFragmentation },
        suggestion: 'Run memory defragmentation or review retention policies',
      });
    }

    // Check token efficiency
    if (metrics.totalTasks > 10 && metrics.tokenEfficiency < 0.5) {
      anomalies.push({
        id: `anomaly_${now}_${Math.random().toString(36).substr(2, 9)}`,
        type: AnomalyType.TOKEN_OVERUSE,
        severity: AnomalySeverity.MEDIUM,
        agentId,
        detectedAt: now,
        description: `Token efficiency is low: ${metrics.tokenEfficiency.toFixed(2)} tasks/1000 tokens`,
        triggerMetrics: { tokenEfficiency: metrics.tokenEfficiency },
        suggestion: 'Review context window usage and consider summarization',
      });
    }

    return anomalies;
  }
}

/**
 * Analyzes health trends over time.
 */
export class HealthTrendAnalyzer {
  private base: BaseMemoryProvider;

  constructor(base: BaseMemoryProvider) {
    this.base = base;
  }

  /**
   * Get aggregated metrics for an agent over a time window.
   */
  async getAggregatedMetrics(
    agentId: string,
    window: MetricsWindow,
    windowStart: number,
    windowEnd: number
  ): Promise<AggregatedMetrics> {
    const items = await this.base.queryItems({
      KeyConditionExpression: 'userId = :pk AND #ts BETWEEN :start AND :end',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pk': `${MEMORY_KEYS.HEALTH_PREFIX}METRIC#${agentId}`,
        ':start': windowStart,
        ':end': windowEnd,
      },
    });

    // Aggregate metrics
    let totalTasks = 0;
    let completedTasks = 0;
    let totalLatency = 0;
    let totalTokens = 0;
    let coherenceSum = 0;
    let coherenceCount = 0;
    let memoryHits = 0;
    let memoryMisses = 0;
    let errors = 0;

    for (const item of items) {
      const name = item.metricName as string;
      const value = item.value as number;

      switch (name) {
        case 'task_completed':
          totalTasks++;
          if (value === 1) completedTasks++;
          else errors++;
          break;
        case 'task_latency_ms':
          totalLatency += value;
          break;
        case 'tokens_used':
          totalTokens += value;
          break;
        case 'reasoning_coherence':
          coherenceSum += value;
          coherenceCount++;
          break;
        case 'memory_hit':
          memoryHits++;
          break;
        case 'memory_miss':
          memoryMisses++;
          break;
      }
    }

    const memoryTotal = memoryHits + memoryMisses;

    return {
      agentId,
      window,
      windowStart,
      windowEnd,
      taskCompletionRate: totalTasks > 0 ? completedTasks / totalTasks : 1,
      avgTaskLatencyMs: totalTasks > 0 ? totalLatency / totalTasks : 0,
      reasoningCoherence: coherenceCount > 0 ? coherenceSum / coherenceCount : 10,
      memoryHitRate: memoryTotal > 0 ? memoryHits / memoryTotal : 1,
      memoryFragmentation: 0, // Calculated separately
      tokenEfficiency: totalTokens > 0 ? (totalTasks / totalTokens) * 1000 : 0,
      errorRate: totalTasks > 0 ? errors / totalTasks : 0,
      totalTasks,
      totalTokens,
    };
  }

  /**
   * Analyze memory health.
   */
  async analyzeMemoryHealth(): Promise<MemoryHealthAnalysis> {
    // This would query memory table for statistics
    // For now, return a placeholder with default values
    return {
      totalItems: 0,
      itemsByTier: {},
      avgAgeDays: 0,
      stalenessScore: 0,
      fragmentationScore: 0,
      coverageScore: 1,
      recommendations: [],
    };
  }
}

/**
 * Main cognitive health monitor combining all components.
 */
export class CognitiveHealthMonitor {
  private collector: MetricsCollector;
  private detector: DegradationDetector;
  private analyzer: HealthTrendAnalyzer;
  private base: BaseMemoryProvider;
  private anomalies: CognitiveAnomaly[] = [];

  constructor(base: BaseMemoryProvider, config?: Partial<CognitiveMetricsConfig>) {
    this.base = base;
    this.collector = new MetricsCollector(base, config);
    this.detector = new DegradationDetector(config);
    this.analyzer = new HealthTrendAnalyzer(base);
  }

  /**
   * Get the metrics collector.
   */
  getCollector(): MetricsCollector {
    return this.collector;
  }

  /**
   * Take a cognitive health snapshot.
   */
  async takeSnapshot(agentIds?: string[]): Promise<CognitiveHealthSnapshot> {
    const now = Date.now();
    const hourAgo = now - TIME.MS_PER_HOUR;

    const agentMetrics: AggregatedMetrics[] = [];
    const allAnomalies: CognitiveAnomaly[] = [];

    // Get metrics for each agent
    const agents = agentIds ?? ['superclaw', 'coder', 'strategic-planner', 'cognition-reflector'];
    for (const agentId of agents) {
      const metrics = await this.analyzer.getAggregatedMetrics(
        agentId,
        MetricsWindow.HOURLY,
        hourAgo,
        now
      );
      agentMetrics.push(metrics);

      // Detect anomalies
      const anomalies = this.detector.detectAnomalies(agentId, metrics);
      allAnomalies.push(...anomalies);
    }

    // Store anomalies
    this.anomalies.push(...allAnomalies);
    if (this.anomalies.length > 100) {
      this.anomalies = this.anomalies.slice(-100);
    }

    // Analyze memory health
    const memoryHealth = await this.analyzer.analyzeMemoryHealth();

    // Calculate overall score
    const overallScore = this.calculateOverallScore(agentMetrics, memoryHealth);

    // Aggregate reasoning metrics
    const reasoning: ReasoningQualityMetrics = {
      coherenceScore:
        agentMetrics.reduce((sum, m) => sum + m.reasoningCoherence, 0) / agentMetrics.length,
      completionRate:
        agentMetrics.reduce((sum, m) => sum + m.taskCompletionRate, 0) / agentMetrics.length,
      avgReasoningSteps: 0, // Would be calculated from raw metrics
      pivotRate: 0,
      clarificationRate: 0,
      selfCorrectionRate: 0,
    };

    return {
      timestamp: now,
      overallScore,
      reasoning,
      memory: memoryHealth,
      anomalies: allAnomalies,
      agentMetrics,
    };
  }

  /**
   * Get recent anomalies.
   */
  getRecentAnomalies(limit: number = 50): CognitiveAnomaly[] {
    return this.anomalies.slice(-limit);
  }

  /**
   * Calculate overall cognitive health score (0-100).
   */
  private calculateOverallScore(
    agentMetrics: AggregatedMetrics[],
    memory: MemoryHealthAnalysis
  ): number {
    if (agentMetrics.length === 0) return 100;

    const avgCompletion =
      agentMetrics.reduce((sum, m) => sum + m.taskCompletionRate, 0) / agentMetrics.length;
    const avgCoherence =
      agentMetrics.reduce((sum, m) => sum + m.reasoningCoherence, 0) / agentMetrics.length / 10;
    const avgErrorRate =
      agentMetrics.reduce((sum, m) => sum + m.errorRate, 0) / agentMetrics.length;

    // Weighted score
    const score =
      avgCompletion * 40 + // 40% weight on completion rate
      avgCoherence * 30 + // 30% weight on reasoning coherence
      (1 - avgErrorRate) * 20 + // 20% weight on low error rate
      (1 - memory.fragmentationScore) * 10; // 10% weight on memory health

    return Math.round(score);
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.collector.destroy();
  }
}
