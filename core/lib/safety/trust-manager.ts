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

export interface TrustContext {
  workspaceId?: string;
  teamId?: string;
  staffId?: string;
}

export class TrustManager {
  /**
   * Records a failure for an agent and penalizes its trust score.
   */
  static async recordFailure(
    agentId: string,
    reason: string,
    severity: number = 1,
    qualityScore?: number,
    context?: TrustContext
  ): Promise<number> {
    let penaltyMultiplier = 1;
    if (qualityScore !== undefined) {
      // Range [0.5, 1.5]: low quality (0) = 1.5x penalty, high quality (10) = 0.5x penalty
      penaltyMultiplier = Math.min(1.5, Math.max(0.5, (10 - qualityScore) / 5 + 0.5));
    }
    const penalty = TRUST.DEFAULT_PENALTY * severity * penaltyMultiplier;

    const newScore = await this.updateTrustScore(agentId, penalty, context?.workspaceId);
    await this.logPenalty(
      { agentId, timestamp: Date.now(), reason, delta: penalty, newScore },
      context
    );

    await emitEvent('system.trust', EventType.REPUTATION_UPDATE, {
      agentId,
      trustScore: newScore,
      metadata: { reason, delta: penalty, type: 'penalty' },
      workspaceId: context?.workspaceId,
      teamId: context?.teamId,
      staffId: context?.staffId,
    });

    return newScore;
  }

  static async recordSuccess(
    agentId: string,
    qualityScore?: number,
    context?: TrustContext
  ): Promise<number> {
    let multiplier = 1;
    if (qualityScore !== undefined) {
      // Range [0, 2]: quality 0 = 0x, quality 5 = 1x, quality 10 = 2x
      multiplier = Math.min(2, Math.max(0, qualityScore * 0.2));
    }
    const bump = TRUST.DEFAULT_SUCCESS_BUMP * multiplier;

    const newScore = await this.updateTrustScore(agentId, bump, context?.workspaceId);
    logger.info(
      `[TrustManager] Agent ${agentId} earned trust (WS: ${context?.workspaceId || 'global'}). Quality: ${qualityScore ?? 'N/A'}. New Score: ${newScore}`
    );

    await emitEvent('system.trust', EventType.REPUTATION_UPDATE, {
      agentId,
      trustScore: newScore,
      metadata: { type: 'success_bump', qualityScore, bump },
      workspaceId: context?.workspaceId,
      teamId: context?.teamId,
      staffId: context?.staffId,
    });

    return newScore;
  }

  static async recordAnomalies(
    agentId: string,
    anomalies: CognitiveAnomaly[],
    context?: TrustContext
  ): Promise<number> {
    if (anomalies.length === 0) {
      const config = await AgentRegistry.getAgentConfig(agentId, {
        workspaceId: context?.workspaceId,
      });
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

    const newScore = await this.updateTrustScore(agentId, totalDelta, context?.workspaceId);
    await this.logPenalty(
      {
        agentId,
        timestamp: Date.now(),
        reason: `Batched Cognitive Anomalies: ${descriptions.join(' | ')}`,
        delta: totalDelta,
        newScore,
      },
      context
    );

    await emitEvent('system.trust', EventType.REPUTATION_UPDATE, {
      agentId,
      trustScore: newScore,
      metadata: { type: 'anomaly_penalty_batch', count: anomalies.length, delta: totalDelta },
      workspaceId: context?.workspaceId,
      teamId: context?.teamId,
      staffId: context?.staffId,
    });

    return newScore;
  }

  private static async updateTrustScore(
    agentId: string,
    delta: number,
    workspaceId?: string
  ): Promise<number> {
    const config = await AgentRegistry.getAgentConfig(agentId, { workspaceId });
    if (!config) throw new Error(`Agent ${agentId} not found`);

    if (config.enabled === false) {
      logger.warn(`[TrustManager] Skipping trust update for disabled agent ${agentId}.`);
      return config.trustScore ?? TRUST.DEFAULT_SCORE;
    }

    if (delta === 0) return config.trustScore ?? TRUST.DEFAULT_SCORE;

    try {
      const newScore = await AgentRegistry.atomicAddAgentField(agentId, 'trustScore', delta, {
        workspaceId,
      });

      const clampedScore = Math.max(TRUST.MIN_SCORE, Math.min(TRUST.MAX_SCORE, newScore));
      if (clampedScore !== newScore) {
        await AgentRegistry.atomicAddAgentField(agentId, 'trustScore', clampedScore - newScore, {
          workspaceId,
        });
      }

      await this.recordHistory(agentId, clampedScore, { workspaceId });
      return clampedScore;
    } catch (e) {
      logger.error(`[TrustManager] Failed to atomically update trust for ${agentId}:`, e);
      // Fallback only if agent config exists to determine a sensible fallback
      // SECURITY: Log audit event for fallback usage to detect potential attacks
      const config = await AgentRegistry.getAgentConfig(agentId, { workspaceId });
      const fallbackScore = config?.trustScore ?? TRUST.DEFAULT_SCORE;
      await this.logFallback(
        {
          agentId,
          timestamp: Date.now(),
          attemptedDelta: delta,
          fallbackScore,
          error: e instanceof Error ? e.message : String(e),
        },
        { workspaceId }
      );
      return fallbackScore;
    }
  }

  private static async logPenalty(penalty: TrustPenalty, context?: TrustContext): Promise<void> {
    const { ConfigManager } = await import('../registry/config');
    const key = context?.workspaceId
      ? `WS#${context.workspaceId}#${DYNAMO_KEYS.TRUST_PENALTY_LOG}`
      : DYNAMO_KEYS.TRUST_PENALTY_LOG;
    await ConfigManager.appendToList(key, penalty, { limit: 200 });
  }

  private static async logFallback(
    fallback: {
      agentId: string;
      timestamp: number;
      attemptedDelta: number;
      fallbackScore: number;
      error: string;
    },
    context?: TrustContext
  ): Promise<void> {
    const { ConfigManager } = await import('../registry/config');
    const key = context?.workspaceId
      ? `WS#${context.workspaceId}#${DYNAMO_KEYS.TRUST_PENALTY_LOG}`
      : DYNAMO_KEYS.TRUST_PENALTY_LOG;
    await ConfigManager.appendToList(
      key,
      {
        ...fallback,
        reason: `FALLBACK: atomic update failed - ${fallback.error}`,
        delta: fallback.attemptedDelta,
        newScore: fallback.fallbackScore,
      },
      { limit: 200 }
    );
  }

  private static async recordHistory(
    agentId: string,
    score: number,
    context?: TrustContext
  ): Promise<void> {
    const { ConfigManager } = await import('../registry/config');
    const key = context?.workspaceId
      ? `WS#${context.workspaceId}#trust:score_history#${agentId}`
      : `trust:score_history#${agentId}`;
    await ConfigManager.appendToList(
      key,
      { agentId, score, timestamp: Date.now() },
      { limit: 200 }
    );
  }

  static async decayTrustScores(workspaceId?: string): Promise<void> {
    const configs = await AgentRegistry.getAllConfigs({ workspaceId });
    await Promise.all(
      Object.entries(configs)
        .filter(([id]) => !AgentRegistry.isBackboneAgent(id))
        .map(([id, cfg]) =>
          this.decayAgentTrust(id, cfg as { trustScore?: number }, { workspaceId })
        )
    );
  }

  private static async decayAgentTrust(
    agentId: string,
    config: { trustScore?: number },
    context?: TrustContext
  ): Promise<void> {
    const score = config.trustScore;
    if (score === undefined || score < TRUST.DECAY_BASELINE) return;

    let multiplier = 1;
    if (score >= TRUST.AUTONOMY_THRESHOLD) multiplier = 1.5;
    else if (score >= 85) multiplier = 1.25;
    const next = Math.max(TRUST.DECAY_BASELINE, score - TRUST.DECAY_RATE * multiplier);
    const delta = Math.round((next - score) * 100) / 100;
    if (delta < 0) {
      await AgentRegistry.atomicAddAgentField(agentId, 'trustScore', delta, {
        workspaceId: context?.workspaceId,
      })
        .then((newScore) => this.recordHistory(agentId, newScore, context))
        .catch((err) => logger.error(`[TrustManager] Failed to decay score for ${agentId}:`, err));
    }
  }
}
