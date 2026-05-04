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
    const workspaceId = context?.workspaceId;
    if (!workspaceId && !AgentRegistry.isBackboneAgent(agentId)) {
      logger.warn(`[TrustManager] recordFailure rejected for ${agentId}: Missing workspaceId.`);
      const current = await AgentRegistry.getAgentConfig(agentId, { workspaceId });
      return current?.trustScore ?? TRUST.DEFAULT_SCORE;
    }

    let penaltyMultiplier = 1;
    if (qualityScore !== undefined) {
      // Range [0.5, 1.5]: low quality (0) = 1.5x penalty, high quality (10) = 0.5x penalty
      penaltyMultiplier = Math.min(1.5, Math.max(0.5, (10 - qualityScore) / 5 + 0.5));
    }
    const penalty = TRUST.DEFAULT_PENALTY * severity * penaltyMultiplier;

    const newScore = await this.updateTrustScore(agentId, penalty, workspaceId);
    await this.logPenalty(
      { agentId, timestamp: Date.now(), reason, delta: penalty, newScore },
      context
    );

    await emitEvent('system.trust', EventType.REPUTATION_UPDATE, {
      agentId,
      trustScore: newScore,
      metadata: { reason, delta: penalty, type: 'penalty' },
      workspaceId,
      teamId: context?.teamId,
      staffId: context?.staffId,
    });

    return newScore;
  }

  /**
   * Records a success for an agent and earns it trust.
   * Capped at 2x DEFAULT_SUCCESS_BUMP to prevent rapid reputation inflation.
   */
  static async recordSuccess(
    agentId: string,
    qualityScore?: number,
    context?: TrustContext
  ): Promise<number> {
    const workspaceId = context?.workspaceId;
    if (!workspaceId && !AgentRegistry.isBackboneAgent(agentId)) {
      logger.warn(`[TrustManager] recordSuccess rejected for ${agentId}: Missing workspaceId.`);
      const current = await AgentRegistry.getAgentConfig(agentId, { workspaceId });
      return current?.trustScore ?? TRUST.DEFAULT_SCORE;
    }

    let multiplier = 1;
    if (qualityScore !== undefined) {
      // Range [0, 2]: quality 0 = 0x, quality 5 = 1x, quality 10 = 2x
      multiplier = Math.min(2, Math.max(0, qualityScore * 0.2));
    }
    const bump = TRUST.DEFAULT_SUCCESS_BUMP * multiplier;

    const newScore = await this.updateTrustScore(agentId, bump, workspaceId);
    logger.info(
      `[TrustManager] Agent ${agentId} earned trust (WS: ${workspaceId || 'global'}). Quality: ${qualityScore ?? 'N/A'}. New Score: ${newScore}`
    );

    await emitEvent('system.trust', EventType.REPUTATION_UPDATE, {
      agentId,
      trustScore: newScore,
      metadata: { type: 'success_bump', qualityScore, bump },
      workspaceId,
      teamId: context?.teamId,
      staffId: context?.staffId,
    });

    return newScore;
  }

  static async recordAnomalies(
    agentId: string,
    anomalies: CognitiveAnomaly[],
    context?: TrustContext & { windowId?: string }
  ): Promise<number> {
    if (anomalies.length === 0) {
      const config = await AgentRegistry.getAgentConfig(agentId, {
        workspaceId: context?.workspaceId,
      });
      if (!config) throw new Error(`Agent ${agentId} not found`);
      return config.trustScore ?? TRUST.DEFAULT_SCORE;
    }

    // Principle 13: Idempotency check for anomaly reporting
    if (context?.windowId) {
      const config = await AgentRegistry.getAgentConfig(agentId, {
        workspaceId: context?.workspaceId,
      });
      if (config?.lastAnomalyCalibrationAt === context.windowId) {
        return config.trustScore ?? TRUST.DEFAULT_SCORE;
      }
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

    try {
      const { ConfigManager } = await import('../registry/config');
      const updates: Record<string, unknown> = {
        lastUpdated: new Date().toISOString(),
      };
      if (context?.windowId) {
        updates.lastAnomalyCalibrationAt = context.windowId;
      }

      // Use atomicUpdateMapEntity to increment trustScore and set lastAnomalyCalibrationAt atomically
      await ConfigManager.atomicUpdateMapEntity(DYNAMO_KEYS.AGENTS_CONFIG, agentId, updates, {
        workspaceId: context?.workspaceId,
        increments: { trustScore: totalDelta },
        conditionExpression: context?.windowId
          ? 'attribute_not_exists(#val.#id.#lac) OR #val.#id.#lac <> :windowId'
          : undefined,
        expressionAttributeNames: context?.windowId ? { '#lac': 'lastAnomalyCalibrationAt' } : {},
        expressionAttributeValues: context?.windowId ? { ':windowId': context.windowId } : {},
      });

      // Fetch fresh score for return and history
      const updated = await AgentRegistry.getAgentConfig(agentId, {
        workspaceId: context?.workspaceId,
      });
      const score = updated?.trustScore ?? 0;

      await this.logPenalty(
        {
          agentId,
          timestamp: Date.now(),
          reason: `Batched Cognitive Anomalies: ${descriptions.join(' | ')}`,
          delta: totalDelta,
          newScore: score,
        },
        context
      );

      await emitEvent('system.trust', EventType.REPUTATION_UPDATE, {
        agentId,
        trustScore: score,
        metadata: {
          type: 'anomaly_penalty_batch',
          count: anomalies.length,
          delta: totalDelta,
          windowId: context?.windowId,
        },
        workspaceId: context?.workspaceId,
        teamId: context?.teamId,
        staffId: context?.staffId,
      });

      return score;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
        // Already recorded for this window
        const config = await AgentRegistry.getAgentConfig(agentId, {
          workspaceId: context?.workspaceId,
        });
        return config?.trustScore ?? TRUST.DEFAULT_SCORE;
      }
      throw err;
    }
  }

  private static async updateTrustScore(
    agentId: string,
    delta: number,
    workspaceId?: string
  ): Promise<number> {
    const config = await AgentRegistry.getAgentConfig(agentId, { workspaceId });
    if (!config) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Principle 14: Selection Integrity - skip updates for disabled agents
    if (config.enabled === false) {
      return config.trustScore ?? TRUST.DEFAULT_SCORE;
    }

    if (delta === 0) {
      return config.trustScore ?? TRUST.DEFAULT_SCORE;
    }

    try {
      const newScore = await AgentRegistry.atomicIncrementTrustScore(agentId, delta, {
        workspaceId,
        min: TRUST.MIN_SCORE,
        max: TRUST.MAX_SCORE,
      });

      await this.recordHistory(agentId, newScore, { workspaceId });
      return newScore;
    } catch (err) {
      logger.error(
        `[TrustManager] Failed to atomically update trust for ${agentId} (WS: ${workspaceId || 'GLOBAL'}):`,
        err
      );
      throw err;
    }
  }

  private static async logPenalty(penalty: TrustPenalty, context?: TrustContext): Promise<void> {
    const { ConfigManager } = await import('../registry/config');
    const key = DYNAMO_KEYS.TRUST_PENALTY_LOG;
    await ConfigManager.appendToList(key, penalty, {
      limit: 200,
      workspaceId: context?.workspaceId,
    });
  }

  private static async recordHistory(
    agentId: string,
    score: number,
    context?: TrustContext
  ): Promise<void> {
    const { ConfigManager } = await import('../registry/config');
    const key = `trust:score_history#${agentId}`;
    await ConfigManager.appendToList(
      key,
      { agentId, score, timestamp: Date.now() },
      { limit: 200, workspaceId: context?.workspaceId }
    );
  }

  static async decayTrustScores(workspaceId?: string): Promise<void> {
    const configs = await AgentRegistry.getAllConfigs({ workspaceId });
    const agentEntries = Object.entries(configs).filter(
      ([id]) => !AgentRegistry.isBackboneAgent(id)
    );

    // Sh6 Fix: implement chunked batching to prevent DDB throttling
    const CHUNK_SIZE = 10;
    for (let i = 0; i < agentEntries.length; i += CHUNK_SIZE) {
      const chunk = agentEntries.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(([id, cfg]) =>
          this.decayAgentTrust(id, cfg as { trustScore?: number }, { workspaceId })
        )
      );
    }
  }

  private static async decayAgentTrust(
    agentId: string,
    config: { trustScore?: number; lastDecayedAt?: string },
    context?: TrustContext
  ): Promise<void> {
    const score = config.trustScore;
    if (score === undefined || score < TRUST.DECAY_BASELINE) return;

    // Principle 13: Idempotency check - skip if already decayed today
    const today = new Date().toISOString().split('T')[0];
    if (config.lastDecayedAt === today) return;

    let multiplier = 1;
    if (score >= TRUST.AUTONOMY_THRESHOLD) multiplier = 1.5;
    else if (score >= 85) multiplier = 1.25;
    const next = Math.max(TRUST.DECAY_BASELINE, score - TRUST.DECAY_RATE * multiplier);
    const delta = Math.round((next - score) * 100) / 100;

    if (delta < 0) {
      try {
        const { AgentRegistry } = await import('../registry');
        const { ConfigManager } = await import('../registry/config');

        await ConfigManager.atomicUpdateMapEntity(
          DYNAMO_KEYS.AGENTS_CONFIG,
          agentId,
          { lastDecayedAt: today, lastUpdated: new Date().toISOString() },
          {
            workspaceId: context?.workspaceId,
            increments: { trustScore: delta },
            conditionExpression: 'attribute_not_exists(#val.#id.#ld) OR #val.#id.#ld <> :today',
            expressionAttributeNames: { '#ld': 'lastDecayedAt' },
            expressionAttributeValues: { ':today': today },
          }
        );

        logger.info(
          `[TrustManager] Decayed trust for ${agentId} by ${delta} (WS: ${context?.workspaceId || 'global'})`
        );

        // Fetch fresh score for history
        const updated = await AgentRegistry.getAgentConfig(agentId, {
          workspaceId: context?.workspaceId,
        });
        if (updated) {
          await this.recordHistory(agentId, updated.trustScore ?? next, context);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
          // Already decayed by another process
        }
        logger.error(
          `[TrustManager] Failed to decay score for ${agentId} (WS: ${context?.workspaceId || 'GLOBAL'}):`,
          err
        );
      }
    }
  }
}
