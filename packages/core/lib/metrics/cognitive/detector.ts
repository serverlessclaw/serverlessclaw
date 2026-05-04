import { logger } from '../../logger';
import { AgentRegistry } from '../../registry/AgentRegistry';
import { SafetyConfigManager } from '../../safety/safety-config-manager';
import { SafetyTier } from '../../types/agent';
import {
  AggregatedMetrics,
  CognitiveAnomaly,
  CognitiveMetricsConfig,
  AnomalyType,
  AnomalySeverity,
} from '../../types/metrics';
import { DEFAULT_CONFIG } from './collector';

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
      logger.warn(
        `Failed to resolve dynamic thresholds for agent ${agentId}, using strict failsafe`,
        e
      );
      return {
        ...this.config.thresholds,
        minCompletionRate: 0.9,
        maxErrorRate: 0.1,
        minCoherence: 7.0,
        maxMissRate: 0.1,
        maxAvgLatencyMs: 10000,
        maxPivotRate: 0.1,
      };
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

    // Check cognitive loop
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
