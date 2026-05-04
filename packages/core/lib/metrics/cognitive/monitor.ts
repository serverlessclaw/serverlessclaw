import { logger } from '../../logger';
import { MEMORY_KEYS, TIME } from '../../constants';
import { BaseMemoryProvider } from '../../memory/base';
import { TrustManager } from '../../safety/trust-manager';
import {
  CognitiveAnomaly,
  CognitiveHealthSnapshot,
  CognitiveMetricsConfig,
  AggregatedMetrics,
  MetricsWindow,
  ReasoningQualityMetrics,
  MemoryHealthAnalysis,
} from '../../types/metrics';
import { MetricsCollector, DEFAULT_CONFIG } from './collector';
import { DegradationDetector } from './detector';
import { HealthTrendAnalyzer } from './analyzer';

/**
 * Main cognitive health monitor combining all components.
 */
export class CognitiveHealthMonitor {
  private collector: MetricsCollector;
  private detector: DegradationDetector;
  private analyzer: HealthTrendAnalyzer;
  private base: BaseMemoryProvider;
  private anomalies: CognitiveAnomaly[] = [];
  private config: CognitiveMetricsConfig;
  private started: boolean = false;

  constructor(base: BaseMemoryProvider, config?: Partial<CognitiveMetricsConfig>) {
    this.base = base;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.collector = new MetricsCollector(base, this.config);
    this.detector = new DegradationDetector(this.config);
    this.analyzer = new HealthTrendAnalyzer(base);
  }

  /**
   * Explicitly start the monitor. Must be called after construction.
   * This replaces automatic start to prevent memory leaks in serverless environments.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.collector.start();
  }

  /**
   * Explicitly stop the monitor to clean up resources.
   */
  stop(): void {
    this.started = false;
    this.collector.destroy();
  }

  getCollector(): MetricsCollector {
    return this.collector;
  }

  async takeSnapshot(agentIds?: string[], workspaceId?: string): Promise<CognitiveHealthSnapshot> {
    const now = Date.now();
    const hourAgo = now - TIME.MS_PER_HOUR;

    const agentMetrics: AggregatedMetrics[] = [];
    const allAnomalies: CognitiveAnomaly[] = [];

    let agents: string[];
    if (agentIds && agentIds.length > 0) {
      agents = agentIds;
    } else {
      const { BACKBONE_REGISTRY } = await import('../../backbone');
      agents = Object.keys(BACKBONE_REGISTRY);
    }

    const metricsPromises = agents.map((agentId) =>
      this.analyzer.getAggregatedMetrics(agentId, MetricsWindow.HOURLY, hourAgo, now, workspaceId)
    );

    const trustManagerPromises: Promise<number>[] = [];
    const results = await Promise.all(metricsPromises);
    const windowId = new Date(now).toISOString().substring(0, 13); // Align to the hour

    for (let i = 0; i < agents.length; i++) {
      const agentId = agents[i];
      const metrics = results[i];
      agentMetrics.push(metrics);

      const anomalies = await this.detector.detectAnomalies(agentId, metrics);
      allAnomalies.push(...anomalies);

      if (anomalies.length > 0) {
        const recordWithRetry = async (): Promise<number> => {
          const maxRetries = 3;
          const baseDelay = 100;
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              return await TrustManager.recordAnomalies(agentId, anomalies, {
                workspaceId,
                windowId,
              });
            } catch (err) {
              if (attempt === maxRetries) {
                logger.error(
                  `[TrustCalibration] All ${maxRetries} retries failed for agent ${agentId} (WS: ${workspaceId || 'global'})`,
                  err
                );
                return 0;
              }
              await new Promise((resolve) => setTimeout(resolve, baseDelay * Math.pow(2, attempt)));
            }
          }
          return 0;
        };
        trustManagerPromises.push(recordWithRetry());
      }
    }

    await Promise.all(trustManagerPromises);

    this.anomalies.push(...allAnomalies);
    if (this.anomalies.length > 1000) {
      this.anomalies = this.anomalies.slice(-1000);
    }

    const memoryHealth = await this.analyzer.analyzeMemoryHealth();
    const overallScore = this.calculateOverallScore(agentMetrics, memoryHealth);

    const totalReasoningSteps = agentMetrics.reduce((sum, m) => sum + m.totalReasoningSteps, 0);
    const totalPivots = agentMetrics.reduce((sum, m) => sum + m.totalPivots, 0);
    const totalClarifications = agentMetrics.reduce((sum, m) => sum + m.totalClarifications, 0);
    const totalSelfCorrections = agentMetrics.reduce((sum, m) => sum + m.totalSelfCorrections, 0);
    const totalAgentTasks = agentMetrics.reduce((sum, m) => sum + m.totalTasks, 0);

    const reasoning: ReasoningQualityMetrics = {
      coherenceScore:
        agentMetrics.reduce((sum, m) => sum + m.reasoningCoherence, 0) / (agentMetrics.length || 1),
      completionRate:
        agentMetrics.reduce((sum, m) => sum + m.taskCompletionRate, 0) / (agentMetrics.length || 1),
      avgReasoningSteps: totalAgentTasks > 0 ? totalReasoningSteps / totalAgentTasks : 0,
      pivotRate: totalAgentTasks > 0 ? totalPivots / totalAgentTasks : 0,
      clarificationRate: totalAgentTasks > 0 ? totalClarifications / totalAgentTasks : 0,
      selfCorrectionRate: totalAgentTasks > 0 ? totalSelfCorrections / totalAgentTasks : 0,
    };

    const snapshot: CognitiveHealthSnapshot = {
      timestamp: now,
      overallScore,
      reasoning,
      memory: memoryHealth,
      anomalies: allAnomalies,
      agentMetrics,
    };

    await this.persistSnapshot(snapshot, workspaceId);
    return snapshot;
  }

  private async persistSnapshot(
    snapshot: CognitiveHealthSnapshot,
    workspaceId?: string
  ): Promise<void> {
    try {
      const expiresAt = Math.floor(
        (Date.now() + this.config.retentionDays * TIME.MS_PER_DAY) / 1000
      );
      const prefix = workspaceId ? `WS#${workspaceId}#` : '';
      for (const metrics of snapshot.agentMetrics) {
        await this.base.putItem({
          userId: `${prefix}${MEMORY_KEYS.HEALTH_PREFIX}SNAPSHOT#${metrics.agentId}`,
          timestamp: snapshot.timestamp,
          type: 'COGNITIVE_SNAPSHOT',
          overallScore: snapshot.overallScore,
          taskCompletionRate: metrics.taskCompletionRate,
          reasoningCoherence: metrics.reasoningCoherence,
          errorRate: metrics.errorRate,
          memoryFragmentation: snapshot.memory.fragmentationScore,
          expiresAt,
          workspaceId,
        });
      }
    } catch (error) {
      logger.error('Failed to persist cognitive health snapshot', { error, workspaceId });
    }
  }

  getRecentAnomalies(limit: number = 50): CognitiveAnomaly[] {
    return this.anomalies.slice(-limit);
  }

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
    const score =
      avgCompletion * 40 +
      avgCoherence * 30 +
      (1 - avgErrorRate) * 20 +
      (1 - memory.fragmentationScore) * 10;
    return Math.round(score);
  }

  destroy(): void {
    this.started = false;
    this.collector.destroy();
  }
}
