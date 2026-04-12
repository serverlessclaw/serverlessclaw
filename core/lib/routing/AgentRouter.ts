/**
 * AgentRouter — Dynamic Model & Agent Selection
 *
 * Implements cost-aware routing by computing composite scores for agent-model
 * combinations based on historical performance, token cost, capability match,
 * and reputation data.
 *
 * This is the unified implementation consolidating logic from agent-router.ts
 * and agent-routing.ts.
 */

import { logger } from '../logger';
import type { IAgentConfig } from '../types/agent';
import { LLMProvider, OpenAIModel, MiniMaxModel, ReasoningProfile } from '../types/llm';
import type { AgentReputation } from '../types/reputation';
import { AgentType } from '../types/agent';
import { computeReputationScore } from '../memory/reputation-operations';
import { TokenTracker } from '../metrics/token-usage';
import { ConfigManager } from '../registry/config';

/**
 * Essential backbone agents that can be used as fallback when user-defined agents fail.
 */
const BACKBONE_FALLBACK_AGENTS = [
  AgentType.SUPERCLAW,
  AgentType.CODER,
  AgentType.STRATEGIC_PLANNER,
];

/**
 * Performance metrics for an agent.
 */
export interface AgentPerformanceMetrics {
  agentId: string;
  successRate: number;
  avgTokensPerInvocation: number;
  capabilityScore: number;
  compositeScore: number;
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
}

/**
 * Model capability tiers for routing decisions.
 */
export enum ModelTier {
  /** Fast, cheap models for simple tasks (e.g., gpt-5-mini, MiniMax M2.7). */
  ECONOMY = 'economy',
  /** Balanced models for standard tasks (e.g., GPT-5.4, GLM-5). */
  BALANCED = 'balanced',
  /** Powerful models for complex reasoning (e.g., Claude 4.6 Sonnet). */
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
 * Order: first is preferred, rest are fallbacks.
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

/**
 * AgentRouter provides dynamic model and agent selection based on task characteristics.
 */
export class AgentRouter {
  private static readonly ROLLBACK_DAYS = 7;

  /**
   * Selects the optimal model for a given agent configuration and task characteristics.
   *
   * @param config - The agent's base configuration.
   * @param options - Task characteristics for routing.
   * @returns The selected provider and model combination.
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

    // If the agent config has explicit overrides, respect them
    if (config.provider && config.model) {
      return {
        provider: config.provider,
        model: config.model,
        tier: PROFILE_TO_TIER[profile] ?? ModelTier.BALANCED,
      };
    }

    // Determine tier from profile and task complexity
    let tier = PROFILE_TO_TIER[profile] ?? ModelTier.BALANCED;

    // Override tier based on budget constraints
    if (options.budget === 'low') {
      tier = ModelTier.ECONOMY;
    } else if (options.budget === 'high') {
      tier = ModelTier.PREMIUM;
    }

    // Override tier based on task complexity
    if (options.taskComplexity !== undefined) {
      if (options.taskComplexity <= 3) tier = ModelTier.ECONOMY;
      else if (options.taskComplexity <= 7) tier = ModelTier.BALANCED;
      else tier = ModelTier.PREMIUM;
    }

    const candidates = TIER_MODELS[tier] ?? TIER_MODELS[ModelTier.BALANCED];

    if (candidates.length === 1) {
      logger.info(
        `[AgentRouter] Selected ${candidates[0].provider}/${candidates[0].model} (tier: ${tier}) for agent ${config.id}`
      );

      return {
        provider: candidates[0].provider,
        model: candidates[0].model,
        tier,
      };
    }

    const selected = await this.weightedModelSelection(candidates);

    logger.info(
      `[AgentRouter] Selected ${selected.provider}/${selected.model} (tier: ${tier}) for agent ${config.id}`
    );

    return {
      provider: selected.provider,
      model: selected.model,
      tier,
    };
  }

  /**
   * Performs weighted/random selection between candidates in the same tier.
   * Uses performance history to weight selection, with fallback to random.
   */
  private static async weightedModelSelection(
    candidates: { provider: string; model: string }[]
  ): Promise<{ provider: string; model: string }> {
    try {
      const weights: number[] = [];

      for (const candidate of candidates) {
        const rollups = await TokenTracker.getRollupRange(
          `${candidate.provider}_${candidate.model}`,
          7
        );
        const totalInvocations = rollups.reduce((s, r) => s + r.invocationCount, 0);
        const totalSuccesses = rollups.reduce((s, r) => s + r.successCount, 0);
        const successRate = totalInvocations > 0 ? totalSuccesses / totalInvocations : 0.5;
        weights.push(successRate + 0.1);
      }

      const totalWeight = weights.reduce((s, w) => s + w, 0);
      let random = Math.random() * totalWeight;

      for (let i = 0; i < candidates.length; i++) {
        random -= weights[i];
        if (random <= 0) {
          return candidates[i];
        }
      }

      return candidates[candidates.length - 1];
    } catch {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
  }

  /**
   * Retrieves performance metrics for an agent, optionally incorporating historical data.
   *
   * @param agentId - The agent ID.
   * @param capabilityScore - 0-1 match for the current task.
   * @returns A promise resolving to agent performance metrics.
   */
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

  /**
   * Computes a composite score for an agent based on its historical performance.
   * Higher scores indicate better candidates for the task.
   *
   * Formula: CapabilityMatch * SuccessRate - (AvgTokens / 10000)
   *
   * @param rollup - The performance rollup data for the agent.
   * @param capabilityMatch - 0-1 score of how well the agent matches the task requirements.
   * @returns A composite score (higher is better).
   */
  static computeScore(rollup: AgentPerformanceRollup, capabilityMatch: number = 1.0): number {
    const successRate = rollup.totalInvocations > 0 ? rollup.successRate : 0.5;
    const avgTokens = rollup.avgInputTokens + rollup.avgOutputTokens;
    const costPenalty = avgTokens / 10000;

    return capabilityMatch * successRate - costPenalty;
  }

  /**
   * Computes a composite score incorporating reputation data.
   *
   * @param performanceScore - The score derived from historical performance/tokens.
   * @param reputationScore - The score derived from reputation metrics.
   * @returns A weighted composite score.
   */
  static computeCompositeScore(performanceScore: number, reputationScore: number): number {
    return 0.6 * performanceScore + 0.4 * reputationScore;
  }

  /**
   * Selects the best agent from a list of candidates based on historical performance metrics.
   *
   * @param candidates - List of candidate agent IDs.
   * @param capabilityScores - Optional map of agent ID to capability score.
   * @returns A promise resolving to the best agent ID.
   */
  static async selectBestAgent(
    candidates: string[],
    capabilityScores?: Record<string, number>
  ): Promise<string> {
    if (candidates.length === 0) throw new Error('No candidate agents provided');

    const { AgentRegistry } = await import('../registry/AgentRegistry');

    // Fetch all candidate configs in parallel for atomic selection
    const configs = await Promise.all(candidates.map((id) => AgentRegistry.getAgentConfig(id)));

    const enabledCandidates: string[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const config = configs[i];
      if (config && config.enabled !== false) {
        enabledCandidates.push(candidates[i]);
      } else {
        logger.warn(`[AgentRouter] Skipping disabled or non-existent agent: ${candidates[i]}`);
      }
    }

    if (enabledCandidates.length === 0) {
      logger.warn(
        `[AgentRouter] All target agents disabled: ${candidates.join(', ')}. Falling back to backbone agents.`
      );
      const fallbackConfigs = await Promise.all(
        BACKBONE_FALLBACK_AGENTS.map((id) => AgentRegistry.getAgentConfig(id))
      );
      const fallbackCandidates: string[] = [];
      for (let i = 0; i < BACKBONE_FALLBACK_AGENTS.length; i++) {
        const config = fallbackConfigs[i];
        if (config && config.enabled !== false) {
          fallbackCandidates.push(BACKBONE_FALLBACK_AGENTS[i]);
        }
      }
      if (fallbackCandidates.length === 0) {
        throw new Error(
          `All target agents and backbone fallback agents are disabled: ${[...candidates, ...BACKBONE_FALLBACK_AGENTS].join(', ')}`
        );
      }
      enabledCandidates.push(...fallbackCandidates);
      logger.info(`[AgentRouter] Using backbone fallback agents: ${fallbackCandidates.join(', ')}`);
    }

    if (enabledCandidates.length === 1) return enabledCandidates[0];

    const metrics = await Promise.all(
      enabledCandidates.map((id) => this.getMetrics(id, capabilityScores?.[id] ?? 1.0))
    );

    metrics.sort((a, b) => b.compositeScore - a.compositeScore);

    return metrics[0].agentId;
  }

  /**
   * Synchronous version for selecting best agent when rollups are already available.
   *
   * @param candidates - Array of performance rollups.
   * @param capabilityMatchFn - Optional function to compute capability match for an agent.
   * @returns The best agent ID, or undefined if no candidates.
   */
  static selectBestAgentSync(
    candidates: AgentPerformanceRollup[],
    capabilityMatchFn?: (agentId: string) => number
  ): string | undefined {
    if (candidates.length === 0) return undefined;

    let bestAgent: string | undefined;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const match = capabilityMatchFn?.(candidate.agentId) ?? 1.0;
      const score = this.computeScore(candidate, match);

      if (score > bestScore) {
        bestScore = score;
        bestAgent = candidate.agentId;
      }
    }

    return bestAgent;
  }

  /**
   * Selects the best agent from candidates, incorporating reputation data.
   *
   * Formula: (0.6 * performanceScore) + (0.4 * reputationScore)
   *
   * @param candidates - Array of agent rollups to evaluate.
   * @param reputations - Map of agentId to reputation data.
   * @param capabilityMatchFn - Function to compute capability match for each candidate.
   * @returns The best agent ID, or undefined if no candidates are available.
   */
  static selectBestAgentWithReputation(
    candidates: AgentPerformanceRollup[],
    reputations: Map<string, AgentReputation>,
    capabilityMatchFn?: (agentId: string) => number
  ): string | undefined {
    if (candidates.length === 0) return undefined;

    let bestAgent: string | undefined;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const match = capabilityMatchFn?.(candidate.agentId) ?? 1.0;
      const performanceScore = this.computeScore(candidate, match);

      const reputation = reputations.get(candidate.agentId);
      const reputationScore = reputation ? computeReputationScore(reputation) : 0.5;

      const compositeScore = this.computeCompositeScore(performanceScore, reputationScore);

      if (compositeScore > bestScore) {
        bestScore = compositeScore;
        bestAgent = candidate.agentId;
      }
    }

    logger.info(
      `[AgentRouter] Best agent (with reputation): ${bestAgent} (score: ${bestScore.toFixed(3)})`
    );
    return bestAgent;
  }
}
