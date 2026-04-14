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
  private static readonly DEFAULT_PENALTY = TRUST.DEFAULT_PENALTY;
  private static readonly DEFAULT_SUCCESS_BUMP = TRUST.DEFAULT_SUCCESS_BUMP;
  private static readonly MAX_SCORE = TRUST.MAX_SCORE;
  private static readonly MIN_SCORE = TRUST.MIN_SCORE;
  private static readonly DECAY_RATE = TRUST.DECAY_RATE;

  /**
   * Records a failure for an agent and penalizes its trust score.
   * Optionally takes a quality score (0-10) to weight the trust adjustment.
   */
  static async recordFailure(
    agentId: string,
    reason: string,
    severity: number = 1,
    qualityScore?: number
  ): Promise<number> {
    let penalty = this.DEFAULT_PENALTY * severity;

    if (qualityScore !== undefined) {
      // Quality-weighted failure penalty (Principle 12)
      // Lower quality failures (0-5) get higher penalty multiplier, higher quality (6-10) get lower
      // formula: (10 - qualityScore) / 10 gives range [0, 1] then scale
      const multiplier = Math.min(1.5, Math.max(0.5, (10 - qualityScore) / 5 + 0.5));
      penalty *= multiplier;
    }

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
      // Scale bump: 10/10 maps to 2x, 5/10 maps to 1x, 0/10 maps to 0x
      // formula: qualityScore * 0.2 gives range [0, 2]
      const multiplier = Math.min(2, Math.max(0, qualityScore * 0.2));
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
      return config?.trustScore ?? TRUST.DEFAULT_SCORE;
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
   * Updates an agent's trust score atomically using DynamoDB conditional updates.
   * Uses retry loop for race-condition safety when concurrent updates occur.
   * NOTE: The retry mechanism handles race conditions - if another update changes the score
   * between our read and write, we'll retry with the fresh value.
   */
  private static async updateTrustScore(agentId: string, delta: number): Promise<number> {
    const MAX_RETRIES = 5;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const fullConfig = await AgentRegistry.getAgentConfig(agentId);
        if (!fullConfig) {
          throw new Error(`Agent ${agentId} not found - cannot update trust score`);
        }
        const currentScore = fullConfig?.trustScore ?? TRUST.DEFAULT_SCORE;
        const newScore = Math.min(this.MAX_SCORE, Math.max(this.MIN_SCORE, currentScore + delta));

        if (newScore === currentScore) {
          return newScore;
        }

        await AgentRegistry.atomicUpdateAgentFieldWithCondition(
          agentId,
          'trustScore',
          newScore,
          currentScore
        );

        await this.recordHistory(agentId, newScore);
        return newScore;
      } catch (e) {
        if (
          attempt < MAX_RETRIES - 1 &&
          e instanceof Error &&
          (e.name === 'ConditionalCheckFailedException' || e.message.includes('conditional'))
        ) {
          logger.debug(
            `Retry updateTrustScore for ${agentId}, attempt ${attempt + 1} - score changed`
          );
          continue;
        }
        logger.error(`Failed to update trust score for ${agentId}:`, e);
        throw e;
      }
    }
    throw new Error(`Failed to update trust score for ${agentId} after ${MAX_RETRIES} retries`);
  }

  /**
   * Logs a penalty event for audit trails atomically.
   */
  private static async logPenalty(penalty: TrustPenalty): Promise<void> {
    const { ConfigManager } = await import('../registry/config');
    await ConfigManager.appendToList(DYNAMO_KEYS.TRUST_PENALTY_LOG, penalty, { limit: 200 });
  }

  /**
   * Records a trust score snapshot in history atomically.
   * Uses per-agent keys for scalability.
   */
  private static async recordHistory(agentId: string, score: number): Promise<void> {
    const { ConfigManager } = await import('../registry/config');
    const historyKey = `${DYNAMO_KEYS.REPUTATION_PREFIX}HISTORY#${agentId}`;

    await ConfigManager.appendToList(
      historyKey,
      { agentId, score, timestamp: Date.now() },
      { limit: 200 }
    );

    // Backward compatibility: also update the legacy global log atomically
    try {
      const legacyKey = DYNAMO_KEYS.TRUST_SCORE_HISTORY;
      await ConfigManager.appendToList(
        legacyKey,
        { agentId, score, timestamp: Date.now() },
        { limit: 100 }
      );
    } catch {
      // Ignore legacy errors
    }
  }

  /**
   * Periodically decays trust scores to ensure autonomy is continuously earned.
   * Decay applies to all agents above minimum score - higher scores decay more aggressively.
   * Uses hysteresis around autonomy threshold to prevent oscillation (Issue 1).
   * This should be called by a scheduled process (e.g. Metabolism).
   */
  static async decayTrustScores(): Promise<void> {
    const configs = await AgentRegistry.getAllConfigs();

    const decayPromises: Promise<void>[] = [];
    const decayDetails: { agentId: string; oldScore: number; newScore: number }[] = [];

    for (const agentId of Object.keys(configs)) {
      const config = configs[agentId];
      if (config.trustScore !== undefined && config.trustScore >= TRUST.DECAY_BASELINE) {
        let decayAmount = this.DECAY_RATE;

        if (config.trustScore >= TRUST.AUTONOMY_THRESHOLD) {
          const HYSTERESIS_MARGIN = 2;
          if (config.trustScore >= TRUST.AUTONOMY_THRESHOLD + HYSTERESIS_MARGIN) {
            decayAmount = this.DECAY_RATE * 1.5;
          } else {
            decayAmount = this.DECAY_RATE * 1.1;
          }
        } else if (config.trustScore >= 85) {
          decayAmount = this.DECAY_RATE * 1.2;
        }

        const newScore = config.trustScore - decayAmount;

        if (newScore < config.trustScore) {
          decayDetails.push({ agentId, oldScore: config.trustScore, newScore });
          decayPromises.push(
            AgentRegistry.atomicUpdateAgentField(agentId, 'trustScore', newScore)
              .then(() => this.recordHistory(agentId, newScore))
              .catch((e) => logger.error(`Failed to apply trust decay for agent ${agentId}`, e))
          );
        }
      }
    }

    if (decayPromises.length > 0) {
      await Promise.all(decayPromises);

      for (const detail of decayDetails) {
        logger.info(
          `[TrustManager] Decayed agent ${detail.agentId}: ${detail.oldScore.toFixed(1)} -> ${detail.newScore.toFixed(1)}`
        );
      }
      logger.info(`[TrustManager] Periodic trust decay applied to ${decayPromises.length} agents.`);
    } else {
      logger.info(`[TrustManager] No agents eligible for trust decay.`);
    }
  }
}
