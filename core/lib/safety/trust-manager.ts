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
        const currentScore = fullConfig?.trustScore ?? TRUST.DEFAULT_SCORE;
        const newScore = Math.min(this.MAX_SCORE, Math.max(this.MIN_SCORE, currentScore + delta));

        if (newScore === currentScore) {
          await this.recordHistory(agentId, newScore);
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
   * This should be called by a scheduled process (e.g. Metabolism).
   */
  static async decayTrustScores(): Promise<void> {
    const configs = await AgentRegistry.getAllConfigs();

    const decayPromises: Promise<void>[] = [];

    for (const agentId of Object.keys(configs)) {
      const config = configs[agentId];
      if (config.trustScore !== undefined && config.trustScore > TRUST.DECAY_BASELINE) {
        // Decay down to a baseline
        const newScore = Math.max(TRUST.DECAY_BASELINE, config.trustScore - this.DECAY_RATE);
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
