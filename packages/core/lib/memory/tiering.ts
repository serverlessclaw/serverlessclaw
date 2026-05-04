import { logger } from '../logger';
import { RETENTION, TIME } from '../constants';
import { getCircuitBreaker } from '../safety/circuit-breaker';

/**
 * Retention IDs for different system logs based on 2026 usage patterns.
 */
export enum RetentionTiers {
  STANDARD = 'MESSAGES_DAYS',
  CRITICAL = 'LESSONS_DAYS',
  EPHEMERAL = 'EPHEMERAL_DAYS',
  TRAILS = 'TRACES_DAYS',
  KNOWLEDGE = 'FACTS_DAYS',
  EVOLUTION = 'GAPS_DAYS',
  SWARM = 'REPUTATION_DAYS',
  SESSIONS = 'SESSION_METADATA_DAYS',
  SUMMARIES = 'SUMMARY_DAYS',
}

/**
 * RetentionManager centralizes logic for system data aging and TTL.
 * @since 2026-03-19
 */
export class RetentionManager {
  static async getExpiresAt(
    category: string,
    userId: string = ''
  ): Promise<{ expiresAt: number; type: string }> {
    const { AgentRegistry } = await import('../registry');

    const upperCategory = category.toUpperCase();
    const userIdUpper = userId.toUpperCase();

    // Standard categorical mapping to avoid if/else noise
    const CATEGORY_MAP: Record<string, { tier: RetentionTiers; type: string }> = {
      LESSONS: { tier: RetentionTiers.CRITICAL, type: 'LESSON' },
      LESSON: { tier: RetentionTiers.CRITICAL, type: 'LESSON' },
      IMPORTANT: { tier: RetentionTiers.CRITICAL, type: 'LESSON' },
      MEMORY: { tier: RetentionTiers.CRITICAL, type: 'LESSON' },
      FACTS: { tier: RetentionTiers.KNOWLEDGE, type: 'FACT' },
      FACT: { tier: RetentionTiers.KNOWLEDGE, type: 'FACT' },
      TRACE: { tier: RetentionTiers.TRAILS, type: 'trace' },
      TRAILS: { tier: RetentionTiers.TRAILS, type: 'trace' },
      TRACES: { tier: RetentionTiers.TRAILS, type: 'trace' },
      GAPS: { tier: RetentionTiers.EVOLUTION, type: 'GAP' },
      GAP: { tier: RetentionTiers.EVOLUTION, type: 'GAP' },
      REPUTATION: { tier: RetentionTiers.SWARM, type: 'REPUTATION' },
      SESSIONS: { tier: RetentionTiers.SESSIONS, type: 'SESSION' },
      SESSION: { tier: RetentionTiers.SESSIONS, type: 'SESSION' },
      SUMMARIES: { tier: RetentionTiers.SUMMARIES, type: 'SUMMARY' },
      SUMMARY: { tier: RetentionTiers.SUMMARIES, type: 'SUMMARY' },
      DISTILLED: { tier: RetentionTiers.SUMMARIES, type: 'msg' }, // Distilled shared with summaries, legacy type msg
      MESSAGES: { tier: RetentionTiers.STANDARD, type: 'msg' },
      EPHEMERAL: { tier: RetentionTiers.EPHEMERAL, type: 'temp' },
    };

    let result = CATEGORY_MAP[upperCategory];

    // Prefix-based overrides for specific storage patterns
    if (!result) {
      if (userIdUpper.startsWith('LESSON#')) result = CATEGORY_MAP.LESSON;
      else if (userIdUpper.startsWith('FACT#')) result = CATEGORY_MAP.FACT;
      else if (userIdUpper.startsWith('REPUTATION#')) result = CATEGORY_MAP.REPUTATION;
      else if (userIdUpper.startsWith('SUMMARY#')) result = CATEGORY_MAP.SUMMARY;
      else if (userIdUpper.startsWith('TEMP#')) result = CATEGORY_MAP.EPHEMERAL;
    }

    if (!result) {
      logger.warn(
        `[RetentionManager] Unknown category "${category}" for userId "${userId}". Defaulting to STANDARD tier.`
      );
      result = { tier: RetentionTiers.STANDARD, type: 'msg' };
    }

    const days = await AgentRegistry.getRetentionDays(result.tier as keyof typeof RETENTION);
    const expiresAt = Math.floor(Date.now() / TIME.MS_PER_SECOND) + days * TIME.SECONDS_IN_DAY;

    return { expiresAt, type: result.type };
  }

  /**
   * Cleans up transient or failed states from the system.
   *
   * @returns A promise resolving when the cleanup is complete.
   */
  static async performSystemCleanup(): Promise<void> {
    try {
      await getCircuitBreaker().reset();
    } catch {
      logger.error('Failed to reset circuit breaker');
    }
  }
}
