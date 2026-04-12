/**
 * @module CognitiveMetrics
 * @description Deep cognitive health monitoring for Serverless Claw.
 * Tracks agent reasoning quality, memory health, and cognitive degradation
 * to enable proactive system optimization and anomaly detection.
 */

import { logger } from '../logger';
import { MEMORY_KEYS, RETENTION, TIME } from '../constants';
import { BaseMemoryProvider } from '../memory/base';
import { DynamoMemory } from '../memory/dynamo-memory';
import { TrustManager } from '../safety/trust-manager';
import { SafetyConfigManager } from '../safety/safety-config-manager';
import { AgentRegistry } from '../registry/AgentRegistry';
import { SafetyTier } from '../types/agent';
import {
  MetricsWindow,
  AnomalySeverity,
  AnomalyType,
  CognitiveMetric,
  AggregatedMetrics,
  CognitiveAnomaly,
  MemoryHealthAnalysis,
  ReasoningQualityMetrics,
  CognitiveHealthSnapshot,
  CognitiveMetricsConfig,
} from '../types/metrics';

const DEFAULT_CONFIG: CognitiveMetricsConfig = {
  enabled: true,
  retentionDays: RETENTION.HEALTH_DAYS,
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
   * Start the auto-flush interval. Must be called explicitly
   * to avoid setInterval leaks in Lambda containers.
   */
  start(): void {
    if (this.config.enabled && !this.flushInterval) {
      // Sh5: Shorter flush interval (10s) suitable for Lambda environments
      this.flushInterval = setInterval(() => this.flush(), 10000);
      // Unref so it doesn't prevent Lambda from freezing
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
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.config.enabled) return;

    const timestamp = Date.now();
    this.buffer.push(
      { agentId, name: 'task_completed', value: success ? 1 : 0, timestamp, metadata },
      { agentId, name: 'task_latency_ms', value: latencyMs, timestamp },
      { agentId, name: 'tokens_used', value: tokensUsed, timestamp }
    );

    // Sh5: Immediate flush for failures to prevent signal loss on container recycling
    if (!success || this.buffer.length > 50) {
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
   * Record a self-correction event (agent detected and fixed its own error).
   */
  async recordSelfCorrection(agentId: string): Promise<void> {
    if (!this.config.enabled) return;

    const timestamp = Date.now();
    this.buffer.push({ agentId, name: 'self_correction', value: 1, timestamp });
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
   * Resolves the effective thresholds for an agent based on its safety tier.
   */
  private async getThresholds(agentId: string) {
    try {
      const agentConfig = await AgentRegistry.getAgentConfig(agentId);
      const tier = agentConfig?.safetyTier ?? SafetyTier.LOCAL;
      const policy = await SafetyConfigManager.getPolicy(tier);

      return {
        ...this.config.thresholds,
        ...(policy.cognitiveThresholds ?? {}),
      };
    } catch (e) {
      logger.warn(`Failed to resolve dynamic thresholds for agent ${agentId}, using defaults`, e);
      return this.config.thresholds;
    }
  }

  /**
   * Analyze aggregated metrics for anomalies.
   */
  async detectAnomalies(agentId: string, metrics: AggregatedMetrics): Promise<CognitiveAnomaly[]> {
    const thresholds = await this.getThresholds(agentId);
    const anomalies: CognitiveAnomaly[] = [];
    const now = Date.now();

    // Check task completion rate
    if (metrics.taskCompletionRate < thresholds.minCompletionRate) {
      anomalies.push({
        id: `anomaly_${now}_${Math.random().toString(36).slice(2, 11)}`,
        type: AnomalyType.TASK_FAILURE_SPIKE,
        severity:
          metrics.taskCompletionRate < thresholds.minCompletionRate / 2
            ? AnomalySeverity.CRITICAL
            : AnomalySeverity.HIGH,
        agentId,
        detectedAt: now,
        description: `Task completion rate dropped to ${(metrics.taskCompletionRate * 100).toFixed(1)}%`,
        triggerMetrics: { taskCompletionRate: metrics.taskCompletionRate },
        suggestion: 'Review recent task failures and check for configuration issues',
      });
    }

    // Check error rate
    if (metrics.errorRate > thresholds.maxErrorRate) {
      anomalies.push({
        id: `anomaly_${now}_${Math.random().toString(36).slice(2, 11)}`,
        type: AnomalyType.TASK_FAILURE_SPIKE,
        severity:
          metrics.errorRate > thresholds.maxErrorRate * 2
            ? AnomalySeverity.CRITICAL
            : AnomalySeverity.HIGH,
        agentId,
        detectedAt: now,
        description: `Error rate elevated to ${(metrics.errorRate * 100).toFixed(1)}%`,
        triggerMetrics: { errorRate: metrics.errorRate },
        suggestion: 'Check error logs and consider rolling back recent changes',
      });
    }

    // Check reasoning coherence
    if (metrics.reasoningCoherence < thresholds.minCoherence) {
      anomalies.push({
        id: `anomaly_${now}_${Math.random().toString(36).slice(2, 11)}`,
        type: AnomalyType.REASONING_DEGRADATION,
        severity:
          metrics.reasoningCoherence < thresholds.minCoherence / 2
            ? AnomalySeverity.CRITICAL
            : AnomalySeverity.MEDIUM,
        agentId,
        detectedAt: now,
        description: `Reasoning coherence dropped to ${metrics.reasoningCoherence.toFixed(1)}/10`,
        triggerMetrics: { reasoningCoherence: metrics.reasoningCoherence },
        suggestion: 'Review agent prompts and consider model upgrade',
      });
    }

    // Check memory miss rate
    if (metrics.memoryMissRate > thresholds.maxMissRate) {
      anomalies.push({
        id: `anomaly_${now}_${Math.random().toString(36).slice(2, 11)}`,
        type: AnomalyType.MEMORY_MISS,
        severity:
          metrics.memoryMissRate > thresholds.maxMissRate * 1.5
            ? AnomalySeverity.HIGH
            : AnomalySeverity.MEDIUM,
        agentId,
        detectedAt: now,
        description: `Memory miss rate at ${(metrics.memoryMissRate * 100).toFixed(1)}%`,
        triggerMetrics: { memoryMissRate: metrics.memoryMissRate },
        suggestion: 'Review memory retention policies or recall strategy',
      });
    }

    // Check token efficiency
    if (metrics.totalTasks >= thresholds.minSampleTasks && metrics.tokenEfficiency < 0.5) {
      anomalies.push({
        id: `anomaly_${now}_${Math.random().toString(36).slice(2, 11)}`,
        type: AnomalyType.TOKEN_OVERUSE,
        severity: AnomalySeverity.MEDIUM,
        agentId,
        detectedAt: now,
        description: `Token efficiency is low: ${metrics.tokenEfficiency.toFixed(2)} tasks/1000 tokens`,
        triggerMetrics: { tokenEfficiency: metrics.tokenEfficiency },
        suggestion: 'Review context window usage and consider summarization',
      });
    }

    // Check latency anomaly
    if (
      metrics.totalTasks >= thresholds.minSampleTasks &&
      metrics.avgTaskLatencyMs > thresholds.maxAvgLatencyMs
    ) {
      anomalies.push({
        id: `anomaly_${now}_${Math.random().toString(36).slice(2, 11)}`,
        type: AnomalyType.LATENCY_ANOMALY,
        severity:
          metrics.avgTaskLatencyMs > thresholds.maxAvgLatencyMs * 2
            ? AnomalySeverity.HIGH
            : AnomalySeverity.MEDIUM,
        agentId,
        detectedAt: now,
        description: `Average task latency elevated to ${metrics.avgTaskLatencyMs.toFixed(0)}ms`,
        triggerMetrics: { avgTaskLatencyMs: metrics.avgTaskLatencyMs },
        suggestion: 'Check for slow LLM providers or tool execution bottlenecks',
      });
    }

    // Check cognitive loop (excessive pivoting without progress)
    const pivotRate = metrics.totalTasks > 0 ? metrics.totalPivots / metrics.totalTasks : 0;
    if (metrics.totalTasks >= thresholds.minSampleTasks && pivotRate > thresholds.maxPivotRate) {
      anomalies.push({
        id: `anomaly_${now}_${Math.random().toString(36).slice(2, 11)}`,
        type: AnomalyType.COGNITIVE_LOOP,
        severity:
          pivotRate > thresholds.maxPivotRate * 1.5
            ? AnomalySeverity.CRITICAL
            : AnomalySeverity.HIGH,
        agentId,
        detectedAt: now,
        description: `High pivot rate detected: ${(pivotRate * 100).toFixed(1)}% — agent may be stuck in a reasoning loop`,
        triggerMetrics: {
          pivotRate,
          totalPivots: metrics.totalPivots,
          totalTasks: metrics.totalTasks,
        },
        suggestion: 'Review agent prompts for ambiguity or consider task decomposition',
      });
    }

    // Check memory fragmentation
    if (metrics.memoryHealth?.fragmentationScore !== undefined) {
      const fragScore = metrics.memoryHealth.fragmentationScore;
      if (fragScore > 0.7) {
        anomalies.push({
          id: `anomaly_${now}_${Math.random().toString(36).slice(2, 11)}`,
          type: AnomalyType.MEMORY_FRAGMENTATION,
          severity: fragScore > 0.9 ? AnomalySeverity.HIGH : AnomalySeverity.MEDIUM,
          agentId,
          detectedAt: now,
          description: `Memory fragmentation score: ${(fragScore * 100).toFixed(0)}% — consider consolidation`,
          triggerMetrics: { memoryFragmentationScore: fragScore },
          suggestion: 'Review memory tier distribution and consolidate overlapping categories',
        });
      }
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
    let totalReasoningSteps = 0;
    let totalPivots = 0;
    let totalClarifications = 0;
    let totalSelfCorrections = 0;

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
        case 'reasoning_steps':
          totalReasoningSteps += value;
          break;
        case 'pivot':
          totalPivots += value;
          break;
        case 'clarification_request':
          totalClarifications += value;
          break;
        case 'self_correction':
          totalSelfCorrections += value;
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
      memoryMissRate: memoryTotal > 0 ? memoryMisses / memoryTotal : 0,
      tokenEfficiency: totalTokens > 0 ? (totalTasks / totalTokens) * 1000 : 0,
      errorRate: totalTasks > 0 ? errors / totalTasks : 0,
      totalTasks,
      totalTokens,
      totalReasoningSteps,
      totalPivots,
      totalClarifications,
      totalSelfCorrections,
    };
  }

  /**
   * Analyze memory health by scanning memory tiers.
   */
  async analyzeMemoryHealth(): Promise<MemoryHealthAnalysis> {
    const now = Date.now();
    const prefixes = [
      MEMORY_KEYS.CONVERSATION_PREFIX,
      MEMORY_KEYS.LESSON_PREFIX,
      MEMORY_KEYS.FACT_PREFIX,
      MEMORY_KEYS.SUMMARY_PREFIX,
    ];

    const allItems: Record<string, unknown>[] = [];
    const MAX_ITEMS_PER_PREFIX = 100;

    for (const prefix of prefixes) {
      try {
        // Sh5: Sample scan instead of full scan to avoid DynamoDB timeouts in large workspaces
        const items = await this.base.scanByPrefix(prefix, { limit: MAX_ITEMS_PER_PREFIX });
        allItems.push(...items);
      } catch (error) {
        logger.warn('Failed to scan prefix for memory health analysis', { prefix, error });
      }
    }

    const totalItems = allItems.length;
    const itemsByTier: Record<string, number> = {};
    let totalAgeDays = 0;

    for (const item of allItems) {
      const userId = (item.userId as string) ?? '';
      const match = userId.match(/^([A-Z_]+#)/);
      const prefix = match?.[1] ?? 'UNKNOWN#';
      itemsByTier[prefix] = (itemsByTier[prefix] || 0) + 1;
      const ts = (item.timestamp as number) ?? 0;
      if (ts > 0) {
        totalAgeDays += (now - ts) / TIME.MS_PER_DAY;
      }
    }

    const avgAgeDays = totalItems > 0 ? totalAgeDays / totalItems : 0;
    const uniqueTiers = Object.keys(itemsByTier).length;
    const stalenessScore = Math.min(1, avgAgeDays / 90);
    const fragmentationScore = totalItems > 100 ? Math.min(1, uniqueTiers / 10) : 0;
    const lessonCount = itemsByTier[MEMORY_KEYS.LESSON_PREFIX] ?? 0;
    const coverageScore = totalItems > 0 ? Math.min(1, lessonCount / 10) : 0;

    const recommendations: string[] = [];
    if (totalItems > 0 && stalenessScore > 0.7)
      recommendations.push('Run memory pruning — many items are older than 60 days');
    if (totalItems > 100 && fragmentationScore > 0.8)
      recommendations.push('Memory is fragmented across many tiers — consider consolidation');
    if (totalItems > 5 && coverageScore < 0.3)
      recommendations.push('Low lesson coverage — agents may be repeating mistakes');

    return {
      totalItems,
      itemsByTier,
      avgAgeDays,
      stalenessScore,
      fragmentationScore,
      coverageScore,
      recommendations,
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
    this.collector.start();
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

    // Sh5: Parallelize metric aggregation to reduce snapshot latency
    const metricsPromises = agents.map((agentId) =>
      this.analyzer.getAggregatedMetrics(agentId, MetricsWindow.HOURLY, hourAgo, now)
    );

    const trustManagerPromises: Promise<number>[] = [];
    const results = await Promise.all(metricsPromises);

    for (let i = 0; i < agents.length; i++) {
      const agentId = agents[i];
      const metrics = results[i];
      agentMetrics.push(metrics);

      // Detect anomalies
      const anomalies = await this.detector.detectAnomalies(agentId, metrics);
      allAnomalies.push(...anomalies);

      // Sh6: Report anomalies to TrustManager for automatic trust calibration
      // Sh6: Batched report to avoid race conditions and reduce writes
      if (anomalies.length > 0) {
        trustManagerPromises.push(
          TrustManager.recordAnomalies(agentId, anomalies).catch((err) => {
            logger.error(`Failed to record trust penalty batch for agent ${agentId}`, err);
            return 0;
          })
        );
      }
    }

    // Await all trust updates to ensure health report is consistent
    await Promise.all(trustManagerPromises);

    // Store anomalies
    this.anomalies.push(...allAnomalies);
    if (this.anomalies.length > 1000) {
      this.anomalies = this.anomalies.slice(-1000);
    }

    // Analyze memory health
    const memoryHealth = await this.analyzer.analyzeMemoryHealth();

    // Calculate overall score
    const overallScore = this.calculateOverallScore(agentMetrics, memoryHealth);

    // Aggregate reasoning metrics
    const totalReasoningSteps = agentMetrics.reduce((sum, m) => sum + m.totalReasoningSteps, 0);
    const totalPivots = agentMetrics.reduce((sum, m) => sum + m.totalPivots, 0);
    const totalClarifications = agentMetrics.reduce((sum, m) => sum + m.totalClarifications, 0);
    const totalSelfCorrections = agentMetrics.reduce((sum, m) => sum + m.totalSelfCorrections, 0);
    const totalAgentTasks = agentMetrics.reduce((sum, m) => sum + m.totalTasks, 0);

    const reasoning: ReasoningQualityMetrics = {
      coherenceScore:
        agentMetrics.reduce((sum, m) => sum + m.reasoningCoherence, 0) / agentMetrics.length,
      completionRate:
        agentMetrics.reduce((sum, m) => sum + m.taskCompletionRate, 0) / agentMetrics.length,
      avgReasoningSteps: totalAgentTasks > 0 ? totalReasoningSteps / totalAgentTasks : 0,
      pivotRate: totalAgentTasks > 0 ? totalPivots / totalAgentTasks : 0,
      clarificationRate: totalAgentTasks > 0 ? totalClarifications / totalAgentTasks : 0,
      selfCorrectionRate: totalAgentTasks > 0 ? totalSelfCorrections / totalAgentTasks : 0,
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
    // 1. Get raw task completions from metrics table
    const items = await this.base.queryItems({
      KeyConditionExpression: 'userId = :pk AND #ts BETWEEN :start AND :end',
      FilterExpression: 'metricName = :name',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pk': `${MEMORY_KEYS.HEALTH_PREFIX}METRIC#${agentId}`,
        ':start': windowStart,
        ':end': windowEnd,
        ':name': 'task_completed',
      },
    });

    const metricsCount = items.length;

    // 2. Verify internal consistency: task_completed vs task_latency_ms should be 1:1
    const latencyItems = await this.base.queryItems({
      KeyConditionExpression: 'userId = :pk AND #ts BETWEEN :start AND :end',
      FilterExpression: 'metricName = :name',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':pk': `${MEMORY_KEYS.HEALTH_PREFIX}METRIC#${agentId}`,
        ':start': windowStart,
        ':end': windowEnd,
        ':name': 'task_latency_ms',
      },
    });

    const latencyCount = latencyItems.length;
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
   * Query TraceTable for actual trace counts within the time window.
   */
  private async getTraceCountFromTable(
    _agentId: string,
    _windowStart: number,
    _windowEnd: number
  ): Promise<number> {
    try {
      // Note: ClawTracer.getTrace() requires a traceId, so we need a different approach
      // For now, we'll use a placeholder that can be enhanced when trace querying is available
      // The ideal approach would be a GSI on agentId + timestamp, but that's a future enhancement
      return 0; // Placeholder: requires TraceTable GSI on agentId for efficient query
    } catch (e) {
      logger.debug('Failed to query TraceTable for consistency check:', e);
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
      parts.push(
        `Internal metrics consistent (${metricsCount} task completions, ${latencyCount} latency records)`
      );
    } else {
      parts.push(
        `INTERNAL DRIFT: ${internalDrift} - task completions (${metricsCount}) vs latency records (${latencyCount})`
      );
    }

    if (traceDrift === 0 || traceCount === 0) {
      parts.push(
        `TraceTable cross-reference: ${traceCount > 0 ? 'consistent' : 'unavailable (requires agentId GSI)'}`
      );
    } else {
      parts.push(
        `TRACE DRIFT: ${traceDrift} - metrics (${metricsCount}) vs actual traces (${traceCount})`
      );
    }

    return parts.join('. ');
  }

  /**
   * Static helper for quick drift detection (default: last 1 hour).
   */
  static async detectDrift(agentId: string, memory?: BaseMemoryProvider): Promise<boolean> {
    const provider = memory ?? new DynamoMemory();
    const probe = new ConsistencyProbe(provider as any);
    const now = Date.now();
    const result = await probe.verifyTraceConsistency(agentId, now - 3600000, now);

    if (!result.consistent) {
      logger.warn(`[Silo 5] Signal drift detected for agent ${agentId}: ${result.details}`);
    }

    return !result.consistent;
  }
}
