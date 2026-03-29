/**
 * @module TrackBudgetAllocator
 * @description Track-aware budget allocation for multi-track evolution.
 * Distributes evolution budget across tracks based on priority and weights,
 * with dynamic rebalancing based on track performance.
 * Persists state via ConfigManager (DynamoDB ConfigTable).
 */

import { EvolutionTrack } from '../types/agent';
import { logger } from '../logger';
import { ConfigManager } from '../registry/config';

/**
 * Per-track allocation state.
 */
export interface TrackAllocation {
  allocatedUsd: number;
  spentUsd: number;
}

/**
 * Budget spend record for audit trail.
 */
export interface BudgetSpendRecord {
  track: EvolutionTrack;
  gapId: string;
  spendUsd: number;
  timestamp: number;
  agentId: string;
}

/**
 * Full persisted budget state.
 */
export interface TrackBudgetState {
  cycleId: string;
  totalBudgetUsd: number;
  expiresAt: number;
  allocations: Record<string, TrackAllocation>;
  spendHistory: BudgetSpendRecord[];
}

/**
 * Default budget weights by track priority.
 */
const DEFAULT_BUDGET_WEIGHTS: Record<EvolutionTrack, number> = {
  [EvolutionTrack.SECURITY]: 0.3,
  [EvolutionTrack.PERFORMANCE]: 0.25,
  [EvolutionTrack.FEATURE]: 0.2,
  [EvolutionTrack.INFRASTRUCTURE]: 0.15,
  [EvolutionTrack.REFACTORING]: 0.1,
};

/**
 * Allocates and tracks budget across evolution tracks.
 * Uses ConfigManager for DynamoDB-backed persistence.
 */
export class TrackBudgetAllocator {
  private static readonly BUDGET_KEY = 'track_evolution_budget';
  private static readonly DEFAULT_TOTAL_BUDGET = 10.0;
  private static readonly DEFAULT_CYCLE_DAYS = 7;
  private static readonly MAX_HISTORY = 1000;

  /**
   * Check if a spend is allowed for a track.
   */
  static async canSpend(track: EvolutionTrack, amountUsd: number): Promise<boolean> {
    const state = await this.getOrCreateState();
    const allocation = state.allocations[track];
    if (!allocation) return false;
    return allocation.allocatedUsd - allocation.spentUsd >= amountUsd;
  }

  /**
   * Record a spend against a track's budget.
   * @returns true if the spend was recorded, false if budget exceeded.
   */
  static async recordSpend(
    track: EvolutionTrack,
    gapId: string,
    spendUsd: number,
    agentId: string
  ): Promise<boolean> {
    const state = await this.getOrCreateState();
    const allocation = state.allocations[track];
    if (!allocation || allocation.allocatedUsd - allocation.spentUsd < spendUsd) {
      logger.warn(`[TrackBudget] Budget exceeded for track ${track}: $${spendUsd} requested`);
      return false;
    }

    allocation.spentUsd += spendUsd;
    state.spendHistory.push({
      track,
      gapId,
      spendUsd,
      timestamp: Date.now(),
      agentId,
    });

    if (state.spendHistory.length > this.MAX_HISTORY) {
      state.spendHistory = state.spendHistory.slice(-this.MAX_HISTORY);
    }

    await ConfigManager.saveRawConfig(this.BUDGET_KEY, state);
    logger.debug(`[TrackBudget] Spend recorded: ${track} $${spendUsd.toFixed(4)} for gap ${gapId}`);
    return true;
  }

  /**
   * Get allocation for a specific track.
   */
  static async getAllocation(
    track: EvolutionTrack
  ): Promise<{ allocatedUsd: number; spentUsd: number; remainingUsd: number } | null> {
    const state = await this.getOrCreateState();
    const a = state.allocations[track];
    if (!a) return null;
    return {
      allocatedUsd: a.allocatedUsd,
      spentUsd: a.spentUsd,
      remainingUsd: a.allocatedUsd - a.spentUsd,
    };
  }

  /**
   * Get total remaining budget across all tracks.
   */
  static async getTotalRemaining(): Promise<number> {
    const state = await this.getOrCreateState();
    let total = 0;
    for (const a of Object.values(state.allocations)) {
      total += a.allocatedUsd - a.spentUsd;
    }
    return total;
  }

  /**
   * Get total spent across all tracks.
   */
  static async getTotalSpent(): Promise<number> {
    const state = await this.getOrCreateState();
    let total = 0;
    for (const a of Object.values(state.allocations)) {
      total += a.spentUsd;
    }
    return total;
  }

  /**
   * Get overall utilization (0-1).
   */
  static async getOverallUtilization(): Promise<number> {
    const state = await this.getOrCreateState();
    const totalSpent = Object.values(state.allocations).reduce((s, a) => s + a.spentUsd, 0);
    return state.totalBudgetUsd > 0 ? totalSpent / state.totalBudgetUsd : 0;
  }

  /**
   * Rebalance budgets based on track performance.
   * Takes budget from underperforming tracks and gives to high-performing ones.
   * Never produces negative remaining budget.
   */
  static async rebalanceBasedOnPerformance(
    trackPerformance: Map<EvolutionTrack, { successRate: number; utilizationRate: number }>
  ): Promise<void> {
    const state = await this.getOrCreateState();

    const underperforming: { track: EvolutionTrack; allocation: TrackAllocation }[] = [];
    const highPerforming: { track: EvolutionTrack; allocation: TrackAllocation }[] = [];

    for (const [trackStr, alloc] of Object.entries(state.allocations)) {
      const track = trackStr as EvolutionTrack;
      const perf = trackPerformance.get(track);
      if (!perf) continue;

      if (perf.successRate < 0.5 && perf.utilizationRate > 0.8) {
        underperforming.push({ track, allocation: alloc });
      } else if (perf.successRate > 0.8 && perf.utilizationRate > 0.5) {
        highPerforming.push({ track, allocation: alloc });
      }
    }

    if (underperforming.length > 0 && highPerforming.length > 0) {
      let freedBudget = 0;
      for (const { allocation } of underperforming) {
        const remaining = allocation.allocatedUsd - allocation.spentUsd;
        const reduction = Math.min(remaining * 0.2, remaining);
        allocation.allocatedUsd -= reduction;
        freedBudget += reduction;
      }

      const perTrackIncrease = freedBudget / highPerforming.length;
      for (const { allocation } of highPerforming) {
        allocation.allocatedUsd += perTrackIncrease;
      }

      await ConfigManager.saveRawConfig(this.BUDGET_KEY, state);
      logger.info(`[TrackBudget] Rebalanced: freed $${freedBudget.toFixed(4)}`);
    }
  }

  /**
   * Get full budget state including all allocations.
   */
  static async getSummary(): Promise<TrackBudgetState> {
    return this.getOrCreateState();
  }

  /**
   * Reset the budget cycle (creates fresh allocations).
   */
  static async resetCycle(): Promise<void> {
    const state = this.createFreshState();
    await ConfigManager.saveRawConfig(this.BUDGET_KEY, state);
    logger.info('[TrackBudget] Budget cycle reset');
  }

  /**
   * Get spend history for a track.
   */
  static async getSpendHistory(track: EvolutionTrack, limit = 100): Promise<BudgetSpendRecord[]> {
    const state = await this.getOrCreateState();
    return state.spendHistory.filter((r) => r.track === track).slice(-limit);
  }

  /**
   * Load or create persisted budget state.
   */
  private static async getOrCreateState(): Promise<TrackBudgetState> {
    const now = Date.now();
    let state = (await ConfigManager.getRawConfig(this.BUDGET_KEY)) as TrackBudgetState | undefined;

    if (!state || now > state.expiresAt) {
      state = this.createFreshState();
      await ConfigManager.saveRawConfig(this.BUDGET_KEY, state);
      logger.info(`[TrackBudget] New budget cycle started: ${state.cycleId}`);
    }

    return state;
  }

  /**
   * Create a fresh budget state for a new cycle.
   */
  private static createFreshState(): TrackBudgetState {
    const now = Date.now();
    const cycleId = new Date().toISOString().slice(0, 10);
    const totalBudgetUsd = this.DEFAULT_TOTAL_BUDGET;
    const allocations: Record<string, TrackAllocation> = {};

    const tracks = Object.values(EvolutionTrack);
    const totalWeight = tracks.reduce((sum, t) => sum + (DEFAULT_BUDGET_WEIGHTS[t] ?? 0), 0);

    for (const track of tracks) {
      const weight = DEFAULT_BUDGET_WEIGHTS[track] ?? 0;
      const rawAllocation = (weight / totalWeight) * totalBudgetUsd;
      allocations[track] = {
        allocatedUsd: Math.round(rawAllocation * 10000) / 10000,
        spentUsd: 0,
      };
    }

    return {
      cycleId,
      totalBudgetUsd,
      expiresAt: now + this.DEFAULT_CYCLE_DAYS * 24 * 60 * 60 * 1000,
      allocations,
      spendHistory: [],
    };
  }
}
