import { TokenRollup } from './token-usage';
import { AgentType } from '../types/agent';
import { logger } from '../logger';

/**
 * Factor used to estimate p95 latency from average latency when percentile data is unavailable.
 * This heuristic accounts for typical long-tail distribution in serverless execution.
 */
const LATENCY_P95_ESTIMATION_FACTOR = 1.25;

async function emitSLOStatusMetrics(
  sloName: string,
  metricType: 'availability' | 'task_success_rate' | 'avg_latency',
  current: number,
  target: number,
  withinBudget: boolean
): Promise<void> {
  try {
    const isLatency = metricType === 'avg_latency';
    const unit = isLatency ? 'Milliseconds' : 'Count';

    const { emitMetrics } = await import('./metrics');
    await emitMetrics([
      {
        MetricName: 'SLOStatus',
        Value: withinBudget ? 1 : 0,
        Unit: 'Count',
        Dimensions: [
          { Name: 'SLO', Value: sloName },
          { Name: 'Status', Value: withinBudget ? 'healthy' : 'breached' },
        ],
      },
      {
        MetricName: 'SLOCurrent',
        Value: current,
        Unit: unit,
        Dimensions: [{ Name: 'SLO', Value: sloName }],
      },
      {
        MetricName: 'SLOTarget',
        Value: target,
        Unit: unit,
        Dimensions: [{ Name: 'SLO', Value: sloName }],
      },
    ]);
  } catch (e) {
    logger.debug(`Failed to emit SLO metrics for ${sloName}:`, e);
  }
}

export interface SLODefinition {
  name: string;
  target: number;
  window: 'daily' | 'weekly' | 'monthly';
  metric: 'availability' | 'task_success_rate' | 'avg_latency';
}

const DEFAULT_SLOS: SLODefinition[] = [
  { name: 'api_availability', target: 0.995, window: 'monthly', metric: 'availability' },
  { name: 'task_success_rate', target: 0.95, window: 'weekly', metric: 'task_success_rate' },
  { name: 'response_latency', target: 30000, window: 'daily', metric: 'avg_latency' },
];

export class SLOTracker {
  /**
   * Calculate current latency value from rollups, with fallback to avg proxy.
   */
  private static calculateLatencyCurrent(rollups: TokenRollup[]): number {
    const p95Values = rollups
      .filter((r) => r.p95DurationMs !== undefined && (r.p95DurationMs as number) > 0)
      .map((r) => r.p95DurationMs as number);
    if (p95Values.length > 0) {
      return p95Values.reduce((s, v) => s + v, 0) / p95Values.length;
    }
    const totalInvocations = rollups.reduce((s, r) => s + r.invocationCount, 0);
    const totalDuration = rollups.reduce((s, r) => s + (r.totalDurationMs || 0), 0);
    const avg = totalInvocations > 0 ? totalDuration / totalInvocations : 0;
    return avg * LATENCY_P95_ESTIMATION_FACTOR;
  }

  static async checkSLO(
    definition: SLODefinition,
    rollups: TokenRollup[]
  ): Promise<{ burnRate: number; withinBudget: boolean }> {
    if (rollups.length === 0) return { burnRate: 0, withinBudget: true };

    let current = 0;
    switch (definition.metric) {
      case 'availability':
      case 'task_success_rate': {
        const totalInvocations = rollups.reduce((s, r) => s + r.invocationCount, 0);
        const totalSuccesses = rollups.reduce((s, r) => s + r.successCount, 0);
        current = totalInvocations > 0 ? totalSuccesses / totalInvocations : 1;
        break;
      }
      case 'avg_latency':
        current = this.calculateLatencyCurrent(rollups);
        break;
    }

    const burnRate =
      definition.metric === 'avg_latency'
        ? current / definition.target
        : (1 - current) / (1 - definition.target);

    return {
      burnRate: Math.round(burnRate * 1000) / 1000,
      withinBudget: burnRate <= 1.0,
    };
  }

  static getSLODefinitions(): SLODefinition[] {
    return DEFAULT_SLOS;
  }

  static async getSLOStatus(
    rollupsBySLO: Record<string, TokenRollup[]>
  ): Promise<Record<string, { current: number; target: number; withinBudget: boolean }>> {
    const result: Record<string, { current: number; target: number; withinBudget: boolean }> = {};

    for (const slo of DEFAULT_SLOS) {
      const rollups = rollupsBySLO[slo.name] ?? [];
      const { withinBudget } = await this.checkSLO(slo, rollups);

      if (!withinBudget) {
        // Mirror Silo 5: SLO breach results in trust penalty for the orchestrator
        try {
          const { SafetyEngine } = await import('../safety/safety-engine');
          const safety = new SafetyEngine();
          await safety.recordFailure(
            AgentType.SUPERCLAW,
            `System SLO Breach: ${slo.name}`,
            2 // Severity 2 for system-level SLO breaches
          );
        } catch (e) {
          logger.warn(`Failed to record SLO trust penalty for ${slo.name}:`, e);
        }
      }

      let current: number;
      if (slo.metric === 'availability' || slo.metric === 'task_success_rate') {
        const total = rollups.reduce((s, r) => s + r.invocationCount, 0);
        const successes = rollups.reduce((s, r) => s + r.successCount, 0);
        current = total > 0 ? successes / total : 1;
      } else if (slo.metric === 'avg_latency') {
        current = this.calculateLatencyCurrent(rollups);
      } else {
        current = 0;
      }

      await emitSLOStatusMetrics(slo.name, slo.metric, current, slo.target, withinBudget);

      result[slo.name] = {
        current: Math.round(current * 1000) / 1000,
        target: slo.target,
        withinBudget,
      };
    }

    return result;
  }
}
