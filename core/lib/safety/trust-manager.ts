/**
 * @module TrustManager
 * @description Centralized logic for managing agent TrustScores, failure penalties,
 * and historical tracking for the Mirror (Silo 6: The Scales).
 */

import { AgentRegistry } from '../registry';
import { DYNAMO_KEYS, TRUST } from '../constants';
import { logger } from '../logger';
import { EventType } from '../types/agent';
import { CognitiveAnomaly, AnomalySeverity } from '../types/metrics';
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
  /**
   * Records a failure for an agent and penalizes its trust score.
   */
  static async recordFailure(
    agentId: string,
    reason: string,
    severity: number = 1,
    qualityScore?: number
  ): Promise<number> {
    let penaltyMultiplier = 1;
    if (qualityScore !== undefined) {
      // Range [0.5, 1.5]: low quality (0) = 1.5x penalty, high quality (10) = 0.5x penalty
      penaltyMultiplier = Math.min(1.5, Math.max(0.5, (10 - qualityScore) / 5 + 0.5));
    }
    const penalty = TRUST.DEFAULT_PENALTY * severity * penaltyMultiplier;

    const newScore = await this.updateTrustScore(agentId, penalty);
    await this.logPenalty({ agentId, timestamp: Date.now(), reason, delta: penalty, newScore });

    logger.warn(
      `[TrustManager] Agent ${agentId} penalized. Reason: ${reason}. New Score: ${newScore}`
    );
    await emitEvent('system.trust', EventType.REPUTATION_UPDATE, {
      agentId,
      trustScore: newScore,
      metadata: { reason, delta: penalty, type: 'penalty' },
    });

    return newScore;
  }

  static async recordSuccess(agentId: string, qualityScore?: number): Promise<number> {
    let multiplier = 1;
    if (qualityScore !== undefined) {
      // Range [0, 2]: quality 0 = 0x, quality 5 = 1x, quality 10 = 2x
      multiplier = Math.min(2, Math.max(0, qualityScore * 0.2));
    }
    const bump = TRUST.DEFAULT_SUCCESS_BUMP * multiplier;

    const newScore = await this.updateTrustScore(agentId, bump);
    logger.info(
      `[TrustManager] Agent ${agentId} earned trust. Quality: ${qualityScore ?? 'N/A'}. New Score: ${newScore}`
    );

    await emitEvent('system.trust', EventType.REPUTATION_UPDATE, {
      agentId,
      trustScore: newScore,
      metadata: { type: 'success_bump', qualityScore, bump },
    });

    return newScore;
  }

  static async recordAnomalies(agentId: string, anomalies: CognitiveAnomaly[]): Promise<number> {
    if (anomalies.length === 0) {
      const config = await AgentRegistry.getAgentConfig(agentId);
      if (!config) throw new Error(`Agent ${agentId} not found`);
      return config.trustScore ?? TRUST.DEFAULT_SCORE;
    }

    let totalDelta = 0;
    const descriptions = anomalies.map((a) => {
      const mod =
        {
          [AnomalySeverity.CRITICAL]: 3,
          [AnomalySeverity.HIGH]: 1.5,
          [AnomalySeverity.MEDIUM]: 0.5,
          [AnomalySeverity.LOW]: 0.1,
        }[a.severity] ?? 1;
      totalDelta += TRUST.DEFAULT_PENALTY * mod;
      return `${a.type}: ${a.description}`;
    });

    const newScore = await this.updateTrustScore(agentId, totalDelta);
    await this.logPenalty({
      agentId,
      timestamp: Date.now(),
      reason: `Batched Cognitive Anomalies: ${descriptions.join(' | ')}`,
      delta: totalDelta,
      newScore,
    });

    await emitEvent('system.trust', EventType.REPUTATION_UPDATE, {
      agentId,
      trustScore: newScore,
      metadata: { type: 'anomaly_penalty_batch', count: anomalies.length, delta: totalDelta },
    });

    return newScore;
  }

  private static async updateTrustScore(agentId: string, delta: number): Promise<number> {
    const config = await AgentRegistry.getAgentConfig(agentId);
    if (!config) throw new Error(`Agent ${agentId} not found`);

    if (config.enabled === false) {
      logger.warn(`[TrustManager] Skipping trust update for disabled agent ${agentId}.`);
      return config.trustScore ?? TRUST.DEFAULT_SCORE;
    }

    if (delta === 0) return config.trustScore ?? TRUST.DEFAULT_SCORE;

    try {
      const newScore = await AgentRegistry.atomicAddAgentField(agentId, 'trustScore', delta);

      if (newScore > TRUST.MAX_SCORE || newScore < TRUST.MIN_SCORE) {
        logger.warn(
          `[TrustManager] Agent ${agentId} trust score ${newScore} exceeds bounds [${TRUST.MIN_SCORE}, ${TRUST.MAX_SCORE}]. Allowing natural decay to correct.`
        );
      }

      await this.recordHistory(agentId, newScore);
      return newScore;
    } catch (e) {
      logger.error(`[TrustManager] Failed to atomically update trust for ${agentId}:`, e);
      // Fallback only if agent config exists to determine a sensible fallback
      const config = await AgentRegistry.getAgentConfig(agentId);
      return config?.trustScore ?? TRUST.DEFAULT_SCORE;
    }
  }

  private static async logPenalty(penalty: TrustPenalty): Promise<void> {
    const { ConfigManager } = await import('../registry/config');
    await ConfigManager.appendToList(DYNAMO_KEYS.TRUST_PENALTY_LOG, penalty, { limit: 200 });
  }

  private static async recordHistory(agentId: string, score: number): Promise<void> {
    const { ConfigManager } = await import('../registry/config');
    await ConfigManager.appendToList(
      `${DYNAMO_KEYS.REPUTATION_PREFIX}HISTORY#${agentId}`,
      { agentId, score, timestamp: Date.now() },
      { limit: 200 }
    );
  }

  static async decayTrustScores(): Promise<void> {
    const configs = await AgentRegistry.getAllConfigs();
    await Promise.all(
      Object.entries(configs)
        .filter(([id]) => !AgentRegistry.isBackboneAgent(id))
        .map(([id, cfg]) => this.decayAgentTrust(id, cfg as { trustScore?: number }))
    );
  }

  private static isBackboneAgent(agentId: string): boolean {
    return (
      agentId in
      {
        superclaw: true,
        coder: true,
        strategic_planner: true,
        cognition_reflector: true,
        qa: true,
        critic: true,
        facilitator: true,
        merger: true,
        build_monitor: true,
        recovery: true,
        researcher: true,
        event_handler: true,
        judge: true,
      }
    );
  }

  private static async decayAgentTrust(
    agentId: string,
    config: { trustScore?: number }
  ): Promise<void> {
    const score = config.trustScore;
    if (score === undefined || score < TRUST.DECAY_BASELINE) return;

    let multiplier = 1;
    if (score >= TRUST.AUTONOMY_THRESHOLD) multiplier = 0.5;
    else if (score >= 85) multiplier = 0.75;
    const next = Math.max(TRUST.DECAY_BASELINE, score - TRUST.DECAY_RATE * multiplier);
    const delta = Math.round((next - score) * 100) / 100;
    if (delta < 0) {
      await AgentRegistry.atomicAddAgentField(agentId, 'trustScore', delta)
        .then((newScore) => this.recordHistory(agentId, newScore))
        .catch((err) => logger.error(`[TrustManager] Failed to decay score for ${agentId}:`, err));
    }
  }
}
