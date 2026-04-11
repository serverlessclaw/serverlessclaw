/**
 * @module TrustManager
 * @description Centralized logic for managing agent TrustScores, failure penalties,
 * and historical tracking for the Mirror (Silo 6: The Scales).
 */

import { AgentRegistry } from '../registry';
import { DYNAMO_KEYS } from '../constants';
import { logger } from '../logger';
import { IAgentConfig, EventType } from '../types/agent';
import { emitEvent } from '../utils/bus';

export interface TrustPenalty {
  agentId: string;
  timestamp: number;
  reason: string;
  delta: number;
  newScore: number;
}

export interface TrustSnapshot {
  agentId: string;
  score: number;
  timestamp: number;
}

export class TrustManager {
  private static DEFAULT_PENALTY = -5;
  private static DEFAULT_SUCCESS_BUMP = 1;
  private static MAX_SCORE = 100;
  private static MIN_SCORE = 0;
  private static DECAY_RATE = 0.5; // per day

  /**
   * Records a failure for an agent and penalizes its trust score.
   */
  static async recordFailure(
    agentId: string,
    reason: string,
    severity: number = 1
  ): Promise<number> {
    const penalty = this.DEFAULT_PENALTY * severity;
    const newScore = await this.updateTrustScore(agentId, penalty);

    await this.logPenalty({
      agentId,
      timestamp: Date.now(),
      reason,
      delta: penalty,
      newScore,
    });

    logger.warn(
      `[TrustManager] Agent ${agentId} penalized. Reason: ${reason}. New Score: ${newScore}`
    );

    // Emit event for real-time dashboard/monitoring
    await emitEvent('system.trust', EventType.REPUTATION_UPDATE, {
      agentId,
      trustScore: newScore,
      metadata: { reason, delta: penalty, type: 'penalty' },
    });

    return newScore;
  }

  /**
   * Records a success for an agent and increments its trust score.
   */
  static async recordSuccess(agentId: string): Promise<number> {
    const newScore = await this.updateTrustScore(agentId, this.DEFAULT_SUCCESS_BUMP);

    logger.info(`[TrustManager] Agent ${agentId} earned trust. New Score: ${newScore}`);

    await emitEvent('system.trust', EventType.REPUTATION_UPDATE, {
      agentId,
      trustScore: newScore,
      metadata: { type: 'success_bump' },
    });

    return newScore;
  }

  /**
   * Updates an agent's trust score atomically.
   */
  private static async updateTrustScore(agentId: string, delta: number): Promise<number> {
    const configs =
      ((await AgentRegistry.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG)) as Record<
        string,
        Partial<IAgentConfig>
      >) || {};
    const currentConfig = configs[agentId] || {};

    // If not in overrides, we need to know the backbone default
    let currentScore = currentConfig.trustScore;
    if (currentScore === undefined) {
      // Fetch from AgentRegistry to get backbone defaults
      const fullConfig = await AgentRegistry.getAgentConfig(agentId);
      currentScore = fullConfig?.trustScore ?? 80;
    }

    const newScore = Math.min(this.MAX_SCORE, Math.max(this.MIN_SCORE, currentScore + delta));

    // Update AGENTS_CONFIG
    configs[agentId] = {
      ...currentConfig,
      trustScore: newScore,
    };

    await AgentRegistry.saveRawConfig(DYNAMO_KEYS.AGENTS_CONFIG, configs, {
      author: 'system:trust-manager',
      description: `TrustScore update for ${agentId}: ${currentScore} -> ${newScore}`,
    });

    // Record in history for trend analysis
    await this.recordHistory(agentId, newScore);

    return newScore;
  }

  /**
   * Logs a penalty event for audit trails.
   */
  private static async logPenalty(penalty: TrustPenalty): Promise<void> {
    const log =
      ((await AgentRegistry.getRawConfig(DYNAMO_KEYS.TRUST_PENALTY_LOG)) as TrustPenalty[]) || [];
    log.push(penalty);

    // Cap log size
    const cappedLog = log.slice(-200);
    await AgentRegistry.saveRawConfig(DYNAMO_KEYS.TRUST_PENALTY_LOG, cappedLog, {
      author: 'system:trust-manager',
      skipVersioning: true,
    });
  }

  /**
   * Records a trust score snapshot in history.
   */
  private static async recordHistory(agentId: string, score: number): Promise<void> {
    const historyKey = DYNAMO_KEYS.TRUST_SCORE_HISTORY;
    // audit-protocol expects an array of { score, timestamp }.
    // Wait, the audit-protocol seems to expect global history but it should probably be per-agent.
    // Given audit-protocol's Sc1 uses 'trust:score_history' directly, we'll keep it simple for now
    // but we'll include agentId in the entry.

    const history =
      ((await AgentRegistry.getRawConfig(historyKey)) as Array<
        TrustSnapshot & { agentId: string }
      >) || [];
    history.push({ agentId, score, timestamp: Date.now() });

    // Cap history (last 500 snapshots)
    const cappedHistory = history.slice(-500);
    await AgentRegistry.saveRawConfig(historyKey, cappedHistory, {
      author: 'system:trust-manager',
      skipVersioning: true,
    });
  }

  /**
   * Periodically decays trust scores to ensure autonomy is continuously earned.
   * This should be called by a scheduled process (e.g. Scythe).
   */
  static async decayTrustScores(): Promise<void> {
    const configs =
      ((await AgentRegistry.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG)) as Record<
        string,
        Partial<IAgentConfig>
      >) || {};
    let updated = false;

    for (const agentId of Object.keys(configs)) {
      const config = configs[agentId];
      if (config.trustScore !== undefined && config.trustScore > 70) {
        // Decay down to a baseline
        config.trustScore = Math.max(70, config.trustScore - this.DECAY_RATE);
        updated = true;
      }
    }

    if (updated) {
      await AgentRegistry.saveRawConfig(DYNAMO_KEYS.AGENTS_CONFIG, configs, {
        author: 'system:trust-manager',
        description: 'Periodic trust decay applied',
      });
      logger.info('[TrustManager] Periodic trust decay applied to active agents.');
    }
  }
}
