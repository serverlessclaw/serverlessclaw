import { TokenRollup } from './token-usage';

export interface SLODefinition {
  name: string;
  target: number;
  window: 'daily' | 'weekly' | 'monthly';
  metric: 'availability' | 'task_success_rate' | 'p95_latency';
}

const DEFAULT_SLOS: SLODefinition[] = [
  { name: 'api_availability', target: 0.995, window: 'monthly', metric: 'availability' },
  { name: 'task_success_rate', target: 0.95, window: 'weekly', metric: 'task_success_rate' },
  { name: 'response_latency', target: 30000, window: 'daily', metric: 'p95_latency' },
];

export class SLOTracker {
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
      case 'p95_latency': {
        const totalTokens = rollups.reduce(
          (s, r) => s + r.totalInputTokens + r.totalOutputTokens,
          0
        );
        current = totalTokens / Math.max(rollups.length, 1);
        break;
      }
    }

    const burnRate =
      definition.metric === 'p95_latency'
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

      let current: number;
      if (slo.metric === 'availability' || slo.metric === 'task_success_rate') {
        const total = rollups.reduce((s, r) => s + r.invocationCount, 0);
        const successes = rollups.reduce((s, r) => s + r.successCount, 0);
        current = total > 0 ? successes / total : 1;
      } else {
        const totalTokens = rollups.reduce(
          (s, r) => s + r.totalInputTokens + r.totalOutputTokens,
          0
        );
        current = totalTokens / Math.max(rollups.length, 1);
      }

      result[slo.name] = {
        current: Math.round(current * 1000) / 1000,
        target: slo.target,
        withinBudget,
      };
    }

    return result;
  }
}
