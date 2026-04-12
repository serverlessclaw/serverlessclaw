/**
 * @module TrustManager
 * @description Centralized logic for managing agent TrustScores, failure penalties,
 * and historical tracking for the Mirror (Silo 6: The Scales).
 */

import { AgentRegistry } from '../registry';
import { DYNAMO_KEYS } from '../constants';
import { logger } from '../logger';
import { IAgentConfig, EventType } from '../types/agent';
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
   * Optionally takes a quality score (0-10) to weight the trust adjustment.
   */
  static async recordSuccess(agentId: string, qualityScore?: number): Promise<number> {
    let bump = this.DEFAULT_SUCCESS_BUMP;

    if (qualityScore !== undefined) {
      // Scale bump: 10/10 maps to 1.5x, 5/10 maps to 0.75x, 0/10 maps to 0x
      const multiplier = Math.max(0, qualityScore / 7.5); // Simplified linear scale
      bump *= multiplier;
    }

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

  /**
   * Records multiple cognitive anomalies for an agent and penalizes the trust score.
   * Batches penalties to ensure atomic updates and reduce database pressure.
   */
  static async recordAnomalies(agentId: string, anomalies: CognitiveAnomaly[]): Promise<number> {
    if (anomalies.length === 0) {
      const config = await AgentRegistry.getAgentConfig(agentId);
      return config?.trustScore ?? 80;
    }

    let totalDelta = 0;
    const descriptions: string[] = [];

    for (const anomaly of anomalies) {
      let severityMod = 1;
      switch (anomaly.severity) {
        case AnomalySeverity.CRITICAL:
          severityMod = 3;
          break;
        case AnomalySeverity.HIGH:
          severityMod = 1.5;
          break;
        case AnomalySeverity.MEDIUM:
          severityMod = 0.5;
          break;
        case AnomalySeverity.LOW:
          severityMod = 0.1;
          break;
      }
      totalDelta += this.DEFAULT_PENALTY * severityMod;
      descriptions.push(`${anomaly.type}: ${anomaly.description}`);
    }

    const newScore = await this.updateTrustScore(agentId, totalDelta);

    await this.logPenalty({
      agentId,
      timestamp: Date.now(),
      reason: `Batched Cognitive Anomalies: ${descriptions.join(' | ')}`,
      delta: totalDelta,
      newScore,
    });

    logger.warn(
      `[TrustManager] Agent ${agentId} penalized for ${anomalies.length} anomalies. New Score: ${newScore}`
    );

    await emitEvent('system.trust', EventType.REPUTATION_UPDATE, {
      agentId,
      trustScore: newScore,
      metadata: {
        type: 'anomaly_penalty_batch',
        count: anomalies.length,
        delta: totalDelta,
      },
    });

    return newScore;
  }

  /**
   * Updates an agent's trust score atomically.
   */
  private static async updateTrustScore(agentId: string, delta: number): Promise<number> {
    // 1. Resolve current score
    const fullConfig = await AgentRegistry.getAgentConfig(agentId);
    const currentScore = fullConfig?.trustScore ?? 80;

    const newScore = Math.min(this.MAX_SCORE, Math.max(this.MIN_SCORE, currentScore + delta));

    // 2. Atomic update in AGENTS_CONFIG
    try {
      await AgentRegistry.atomicUpdateAgentField(agentId, 'trustScore', newScore);
    } catch (e) {
      // Fallback: If atomic update fails (e.g. agent doesn't exist in registry yet)
      // we might need to create the agent config first, but trust manager
      // usually works on existing agents.
      logger.error(`Failed to update trust score for ${agentId} via atomic field update`, e);
      throw e;
    }

    // 3. Record in history for trend analysis
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
   * Uses per-agent keys for scalability.
   */
  private static async recordHistory(agentId: string, score: number): Promise<void> {
    const historyKey = `${DYNAMO_KEYS.REPUTATION_PREFIX}HISTORY#${agentId}`;

    // Fetch agent-specific history
    const history = ((await AgentRegistry.getRawConfig(historyKey)) as TrustSnapshot[]) || [];

    history.push({ agentId, score, timestamp: Date.now() });

    // Cap per-agent history (last 200 snapshots)
    const cappedHistory = history.slice(-200);

    await AgentRegistry.saveRawConfig(historyKey, cappedHistory, {
      author: 'system:trust-manager',
      skipVersioning: true,
      description: `Trust history snapshot for ${agentId}`,
    });

    // Backward compatibility: also update the legacy global log if it's small
    // (We'll phase this out eventually)
    try {
      const legacyKey = DYNAMO_KEYS.TRUST_SCORE_HISTORY;
      const legacyHistory =
        ((await AgentRegistry.getRawConfig(legacyKey)) as Array<
          TrustSnapshot & { agentId: string }
        >) || [];
      legacyHistory.push({ agentId, score, timestamp: Date.now() });
      const cappedLegacy = legacyHistory.slice(-100); // Smaller cap for global log
      await AgentRegistry.saveRawConfig(legacyKey, cappedLegacy, {
        author: 'system:trust-manager',
        skipVersioning: true,
      });
    } catch {
      // Ignore legacy errors
    }
  }

  /**
   * Periodically decays trust scores to ensure autonomy is continuously earned.
   * This should be called by a scheduled process (e.g. Metabolism).
   */
  static async decayTrustScores(): Promise<void> {
    const configs =
      ((await AgentRegistry.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG)) as Record<
        string,
        Partial<IAgentConfig>
      >) || {};

    const decayPromises: Promise<void>[] = [];

    for (const agentId of Object.keys(configs)) {
      const config = configs[agentId];
      if (config.trustScore !== undefined && config.trustScore > 70) {
        // Decay down to a baseline
        const newScore = Math.max(70, config.trustScore - this.DECAY_RATE);
        decayPromises.push(
          AgentRegistry.atomicUpdateAgentField(agentId, 'trustScore', newScore)
            .then(() => this.recordHistory(agentId, newScore))
            .catch((e) => logger.error(`Failed to apply trust decay for agent ${agentId}`, e))
        );
      }
    }

    if (decayPromises.length > 0) {
      await Promise.all(decayPromises);
      logger.info(`[TrustManager] Periodic trust decay applied to ${decayPromises.length} agents.`);
    }
  }
}
