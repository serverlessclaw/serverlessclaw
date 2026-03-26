/**
 * AgentRouter — Dynamic Model & Agent Selection
 *
 * Implements cost-aware routing by computing composite scores for agent-model
 * combinations based on historical performance, token cost, and capability match.
 *
 * GAP #4 FIX: Per-agent model selection for optimal cost/performance ratio.
 */

import { logger } from './logger';
import type { IAgentConfig } from './types/agent';
import { ReasoningProfile } from './types/llm';

/**
 * Performance rollup data for an agent-model combination.
 */
interface AgentPerformanceRollup {
  agentId: string;
  model: string;
  avgInputTokens: number;
  avgOutputTokens: number;
  successRate: number;
  totalInvocations: number;
  avgDurationMs: number;
}

/**
 * Model capability tiers for routing decisions.
 */
export enum ModelTier {
  /** Fast, cheap models for simple tasks (e.g., gpt-5.4-mini, MiniMax M2.7). */
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
    { provider: 'minimax', model: 'MiniMax-M2.7' },
    { provider: 'openai', model: 'gpt-5.4-mini' },
  ],
  [ModelTier.BALANCED]: [
    { provider: 'openai', model: 'gpt-5.4' },
    { provider: 'openrouter', model: 'glm-5' },
    { provider: 'minimax', model: 'MiniMax-M2.7' },
  ],
  [ModelTier.PREMIUM]: [
    { provider: 'bedrock', model: 'claude-4.6-sonnet' },
    { provider: 'openai', model: 'gpt-5.4' },
  ],
};

/**
 * AgentRouter provides dynamic model and agent selection based on task characteristics.
 */
export class AgentRouter {
  /**
   * Selects the optimal model for a given agent configuration and task characteristics.
   *
   * @param config - The agent's base configuration.
   * @param options - Task characteristics for routing.
   * @returns The selected provider and model combination.
   */
  static selectModel(
    config: IAgentConfig,
    options: {
      profile?: ReasoningProfile;
      taskComplexity?: number; // 1-10
      budget?: 'low' | 'normal' | 'high';
    } = {}
  ): { provider: string; model: string; tier: ModelTier } {
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
    const selected = candidates[0]; // Prefer the first candidate

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
   * Selects the best agent from a list of candidates based on historical performance.
   *
   * @param candidates - Array of agent rollups to evaluate.
   * @param capabilityMatchFn - Function to compute capability match for each candidate.
   * @returns The best agent ID, or undefined if no candidates are available.
   */
  static selectBestAgent(
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

    logger.info(`[AgentRouter] Best agent: ${bestAgent} (score: ${bestScore.toFixed(3)})`);
    return bestAgent;
  }
}
