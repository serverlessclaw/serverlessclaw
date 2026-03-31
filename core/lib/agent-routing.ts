import { TokenTracker } from './metrics/token-usage';
import { logger } from './logger';
import { ConfigManager } from './registry/config';

export interface AgentPerformanceMetrics {
  agentId: string;
  successRate: number;
  avgTokensPerInvocation: number;
  capabilityScore: number;
  compositeScore: number;
}

export class AgentRouter {
  private static readonly ROLLBACK_DAYS = 7;

  static async getMetrics(
    agentId: string,
    capabilityScore = 1.0
  ): Promise<AgentPerformanceMetrics> {
    let successRate = 0.5;
    let avgTokensPerInvocation = 0;

    try {
      const rollups = await TokenTracker.getRollupRange(agentId, this.ROLLBACK_DAYS);
      if (rollups.length > 0) {
        const totalInvocations = rollups.reduce((s, r) => s + r.invocationCount, 0);
        const totalSuccesses = rollups.reduce((s, r) => s + r.successCount, 0);
        const totalTokens = rollups.reduce(
          (s, r) => s + r.totalInputTokens + r.totalOutputTokens,
          0
        );
        successRate = totalInvocations > 0 ? totalSuccesses / totalInvocations : 0.5;
        avgTokensPerInvocation = totalInvocations > 0 ? totalTokens / totalInvocations : 0;
      }
    } catch (e) {
      logger.warn(`Failed to get metrics for agent ${agentId}:`, e);
    }

    const successWeight = await ConfigManager.getTypedConfig('router_success_weight', 1.0);
    const tokenWeight = await ConfigManager.getTypedConfig('router_token_penalty_weight', 0.0001);

    const compositeScore =
      capabilityScore * successRate * successWeight - avgTokensPerInvocation * tokenWeight;

    return {
      agentId,
      successRate: Math.round(successRate * 1000) / 1000,
      avgTokensPerInvocation: Math.round(avgTokensPerInvocation),
      capabilityScore,
      compositeScore: Math.round(compositeScore * 1000) / 1000,
    };
  }

  static async selectBestAgent(
    candidates: string[],
    capabilityScores?: Record<string, number>
  ): Promise<string> {
    if (candidates.length === 0) throw new Error('No candidate agents provided');
    if (candidates.length === 1) return candidates[0];

    const metrics = await Promise.all(
      candidates.map((id) => this.getMetrics(id, capabilityScores?.[id] ?? 1.0))
    );

    metrics.sort((a, b) => b.compositeScore - a.compositeScore);

    return metrics[0].agentId;
  }
}
