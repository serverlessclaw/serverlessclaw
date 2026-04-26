/**
 * AgentRouter — Dynamic Model & Agent Selection
 *
 * Implements cost-aware routing by computing composite scores for agent-model
 * combinations based on historical performance, token cost, capability match,
 * and reputation data.
 */

import { logger } from '../logger';
import type { IAgentConfig } from '../types/agent';
import { LLMProvider, OpenAIModel, MiniMaxModel, ReasoningProfile } from '../types/llm';
import type { AgentReputation } from '../types/reputation';

import { computeReputationScore, getReputations } from '../memory/reputation-operations';
import { BaseMemoryProvider } from '../memory/base';
import { TokenTracker } from '../metrics/token-usage';
import { ConfigManager } from '../registry/config';

const sharedMemoryProvider = new BaseMemoryProvider();

/**
 * Performance metrics for an agent.
 */
export interface AgentPerformanceMetrics {
  agentId: string;
  successRate: number;
  avgTokensPerInvocation: number;
  capabilityScore: number;
  compositeScore: number;
  trustScore?: number;
}

/**
 * Performance rollup data for an agent-model combination.
 */
export interface AgentPerformanceRollup {
  agentId: string;
  model?: string;
  avgInputTokens: number;
  avgOutputTokens: number;
  successRate: number;
  totalInvocations: number;
  avgDurationMs?: number;
  enabled?: boolean;
}

/**
 * Model capability tiers for routing decisions.
 */
export enum ModelTier {
  ECONOMY = 'economy',
  BALANCED = 'balanced',
  PREMIUM = 'premium',
}

/**
 * Maps reasoning profiles to optimal model tiers.
 */
const PROFILE_TO_TIER: Record<ReasoningProfile, ModelTier> = {
  [ReasoningProfile.FAST]: ModelTier.ECONOMY,
  [ReasoningProfile.STANDARD]: ModelTier.BALANCED,
  [ReasoningProfile.THINKING]: ModelTier.BALANCED,
  [ReasoningProfile.DEEP]: ModelTier.PREMIUM,
};

/**
 * Maps model tiers to preferred models.
 */
const TIER_MODELS: Record<ModelTier, { provider: string; model: string }[]> = {
  [ModelTier.ECONOMY]: [
    { provider: LLMProvider.MINIMAX, model: MiniMaxModel.M2_7 },
    { provider: LLMProvider.OPENAI, model: OpenAIModel.GPT_5_MINI },
  ],
  [ModelTier.BALANCED]: [
    { provider: LLMProvider.MINIMAX, model: MiniMaxModel.M2_7 },
    { provider: LLMProvider.OPENAI, model: OpenAIModel.GPT_5_4_MINI },
  ],
  [ModelTier.PREMIUM]: [
    { provider: LLMProvider.MINIMAX, model: MiniMaxModel.M2_7 },
    { provider: LLMProvider.OPENAI, model: OpenAIModel.GPT_5_4 },
  ],
};

import { AgentRegistry } from '../registry/AgentRegistry';

/**
 * AgentRouter provides dynamic model and agent selection based on task characteristics.
 */
export class AgentRouter {
  private static readonly ROLLBACK_DAYS = 7;

  /**
   * Selects the optimal model for a given agent configuration and task characteristics.
   */
  static async selectModel(
    config: IAgentConfig,
    options: {
      profile?: ReasoningProfile;
      taskComplexity?: number; // 1-10
      budget?: 'low' | 'normal' | 'high';
    } = {}
  ): Promise<{ provider: string; model: string; tier: ModelTier }> {
    const profile = options.profile ?? config.reasoningProfile ?? ReasoningProfile.STANDARD;

    if (config.provider && config.model) {
      return {
        provider: config.provider,
        model: config.model,
        tier: PROFILE_TO_TIER[profile] ?? ModelTier.BALANCED,
      };
    }

    let tier = PROFILE_TO_TIER[profile] ?? ModelTier.BALANCED;
    if (options.budget === 'low') tier = ModelTier.ECONOMY;
    else if (options.budget === 'high') tier = ModelTier.PREMIUM;

    if (options.taskComplexity !== undefined) {
      if (options.taskComplexity <= 3) tier = ModelTier.ECONOMY;
      else if (options.taskComplexity <= 7) tier = ModelTier.BALANCED;
      else tier = ModelTier.PREMIUM;
    }

    const candidates = TIER_MODELS[tier] ?? TIER_MODELS[ModelTier.BALANCED];
    const selected =
      candidates.length === 1
        ? candidates[0]
        : await this.weightedModelSelection(candidates, config.workspaceId);

    logger.info(
      `[AgentRouter] Selected ${selected.provider}/${selected.model} (tier: ${tier}) for agent ${config.id}`
    );

    return { ...selected, tier };
  }

  /**
   * Performs weighted selection between candidates based on historical performance.
   */
  private static async weightedModelSelection(
    candidates: { provider: string; model: string }[],
    workspaceId?: string
  ): Promise<{ provider: string; model: string }> {
    try {
      const performancePromises = candidates.map(async (c) => {
        const rollups = await TokenTracker.getRollupRange(`${c.provider}_${c.model}`, 7, {
          workspaceId,
        });
        const totalInvocations = rollups.reduce((s, r) => s + r.invocationCount, 0);
        const totalSuccesses = rollups.reduce((s, r) => s + r.successCount, 0);
        return totalInvocations > 0 ? totalSuccesses / totalInvocations + 0.1 : 0.6;
      });

      const weights = await Promise.all(performancePromises);
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      let random = Math.random() * totalWeight;

      for (let i = 0; i < candidates.length; i++) {
        random -= weights[i];
        if (random <= 0) return candidates[i];
      }
      return candidates[candidates.length - 1];
    } catch {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }

  static async getMetrics(
    agentId: string,
    capabilityScore = 1.0,
    workspaceId?: string,
    trustScore?: number
  ): Promise<AgentPerformanceMetrics> {
    let successRate = 0.5;
    let avgTokens = 0;

    try {
      const rollups = await TokenTracker.getRollupRange(agentId, this.ROLLBACK_DAYS, {
        workspaceId,
      });
      if (rollups.length > 0) {
        const totalInvocations = rollups.reduce((s, r) => s + r.invocationCount, 0);
        const totalSuccesses = rollups.reduce((s, r) => s + r.successCount, 0);
        const totalTokens = rollups.reduce(
          (s, r) => s + r.totalInputTokens + r.totalOutputTokens,
          0
        );
        successRate = totalInvocations > 0 ? totalSuccesses / totalInvocations : 0.5;
        avgTokens = totalInvocations > 0 ? totalTokens / totalInvocations : 0;
      }
    } catch (e) {
      logger.warn(`Failed to get metrics for agent ${agentId} (WS: ${workspaceId}):`, e);
    }

    const successWeight = await ConfigManager.getTypedConfig('router_success_weight', 1.0, {
      workspaceId,
    });

    // P1 Fix: Normalize trustScore (0-100) to 0-1 and include in routing decision
    const normalizedTrust = (trustScore ?? 80) / 100.0;
    const compositeScore = capabilityScore * successRate * successWeight * normalizedTrust;

    return {
      agentId,
      successRate: Math.round(successRate * 1000) / 1000,
      avgTokensPerInvocation: Math.round(avgTokens),
      capabilityScore,
      compositeScore: Math.round(compositeScore * 1000) / 1000,
      trustScore,
    };
  }

  /**
   * Selection Integrity check: filters only enabled agents.
   */
  private static filterEnabled(candidates: AgentPerformanceRollup[]): AgentPerformanceRollup[] {
    const enabled = candidates.filter((c) => c.enabled === true);
    if (enabled.length === 0 && candidates.length > 0) {
      logger.warn(
        `[AgentRouter] Selection Integrity check failed: ${candidates.length} candidates, 0 verified as enabled.`
      );
    }
    return enabled;
  }

  /**
   * Computes a composite score for an agent based on its historical performance.
   * Higher scores indicate better candidates for the task.
   */
  static computeScore(rollup: AgentPerformanceRollup, capabilityMatch: number = 1.0): number {
    const successRate = rollup.totalInvocations > 0 ? rollup.successRate : 0.5;
    return capabilityMatch * successRate;
  }

  /**
   * Computes a composite score incorporating reputation data.
   */
  static computeCompositeScore(performanceScore: number, reputationScore: number): number {
    return 0.6 * performanceScore + 0.4 * reputationScore;
  }

  /**
   * Selects the best agent based on historical performance.
   */
  static async selectBestAgent(
    candidates: string[],
    capabilityScores?: Record<string, number>,
    scope?: string | import('../types/memory').ContextualScope
  ): Promise<string> {
    if (candidates.length === 0) throw new Error('No candidate agents provided');

    const workspaceId = typeof scope === 'string' ? undefined : scope?.workspaceId;
    const configs = await Promise.all(
      candidates.map((id) => AgentRegistry.getAgentConfig(id, { workspaceId }))
    );
    let enabledIds = candidates.filter((id, i) => configs[i]?.enabled === true);

    if (enabledIds.length === 0) {
      logger.warn(`[AgentRouter] Target agents disabled. Using backbone fallback.`);
      const fallbacks = AgentRegistry.getFallbackAgents();
      const fbConfigs = await Promise.all(
        fallbacks.map((id) => AgentRegistry.getAgentConfig(id, { workspaceId }))
      );
      enabledIds = fallbacks.filter((id, i) => fbConfigs[i]?.enabled === true);
      if (enabledIds.length === 0)
        throw new Error(`Critical: All target and backbone fallback agents are disabled.`);
    }

    if (enabledIds.length === 1) return enabledIds[0];

    // Fetch performance metrics and reputations in parallel
    const [metrics, reputations] = await Promise.all([
      Promise.all(
        enabledIds.map((id) => {
          const config = configs[candidates.indexOf(id)];
          return this.getMetrics(
            id,
            capabilityScores?.[id] ?? 1.0,
            workspaceId,
            config?.trustScore
          );
        })
      ),
      getReputations(sharedMemoryProvider, enabledIds, scope),
    ]);

    // Compute composite scores incorporating reputation
    const weightedMetrics = metrics.map((m) => {
      const rep = reputations.get(m.agentId);
      const repScore = rep ? computeReputationScore(rep) : 0.5;
      const composite = this.computeCompositeScore(m.compositeScore, repScore);
      return { ...m, compositeScore: composite };
    });

    weightedMetrics.sort((a, b) => b.compositeScore - a.compositeScore);
    const best = weightedMetrics[0].agentId;

    const workspaceLabel = typeof scope === 'string' ? scope : (scope?.workspaceId ?? 'global');

    logger.info(
      `[AgentRouter] Selected best agent for task: ${best} (Score: ${weightedMetrics[0].compositeScore.toFixed(3)}, Workspace: ${workspaceLabel})`
    );

    return best;
  }

  /**
   * Synchronous version for selecting best agent.
   */
  static selectBestAgentSync(
    candidates: AgentPerformanceRollup[],
    capabilityMatchFn?: (agentId: string) => number
  ): string | undefined {
    const enabled = this.filterEnabled(candidates);
    let bestAgent: string | undefined;
    let bestScore = -Infinity;

    for (const c of enabled) {
      const match = capabilityMatchFn?.(c.agentId) ?? 1.0;
      const score = this.computeScore(c, match);
      if (score > bestScore) {
        bestScore = score;
        bestAgent = c.agentId;
      }
    }
    return bestAgent;
  }

  /**
   * Selects the best agent incorporating reputation data.
   */
  static selectBestAgentWithReputation(
    candidates: AgentPerformanceRollup[],
    reputations: Map<string, AgentReputation>,
    capabilityMatchFn?: (agentId: string) => number
  ): string | undefined {
    const enabled = this.filterEnabled(candidates);
    let bestAgent: string | undefined;
    let bestScore = -Infinity;

    for (const c of enabled) {
      const match = capabilityMatchFn?.(c.agentId) ?? 1.0;
      const perfScore = this.computeScore(c, match);
      const rep = reputations.get(c.agentId);
      const repScore = rep ? computeReputationScore(rep) : 0.5;
      const composite = this.computeCompositeScore(perfScore, repScore);

      if (composite > bestScore) {
        bestScore = composite;
        bestAgent = c.agentId;
      }
    }

    if (bestAgent)
      logger.info(
        `[AgentRouter] Best agent (with reputation): ${bestAgent} (score: ${bestScore.toFixed(3)})`
      );
    return bestAgent;
  }
}
