import { logger } from '../logger';
import { RETENTION, TIME, MEMORY_KEYS } from '../constants';
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
  /**
   * Resolves the TTL timestamp and type for a specific memory category.
   *
   * @param category - The memory category (e.g., 'MESSAGES', 'LESSONS', 'TRACES').
   * @param userId - Optional user identifier to handle ephemeral/temporary logic.
   * @returns A promise resolving to an object containing the expiration timestamp and memory type.
   */
  static async getExpiresAt(
    category: string,
    userId: string = ''
  ): Promise<{ expiresAt: number; type: string }> {
    const { AgentRegistry } = await import('../registry');

    let tier = RetentionTiers.STANDARD;
    let type = 'msg';

    const upperCategory = category.toUpperCase();

    // 1. Critical Intelligence (Lessons/Facts)
    if (
      upperCategory === 'LESSONS' ||
      upperCategory === 'LESSON' ||
      upperCategory === 'IMPORTANT' ||
      upperCategory === 'MEMORY' ||
      userId.startsWith(MEMORY_KEYS.LESSON_PREFIX)
    ) {
      tier = RetentionTiers.CRITICAL;
      type = 'LESSON';
    } else if (
      upperCategory === 'FACTS' ||
      upperCategory === 'FACT' ||
      userId.startsWith(MEMORY_KEYS.FACT_PREFIX)
    ) {
      tier = RetentionTiers.KNOWLEDGE;
      type = 'FACT';
    }
    // 2. Observability (Traces/Trails)
    else if (
      upperCategory === 'TRACE' ||
      upperCategory === 'TRAILS' ||
      upperCategory === 'TRACES'
    ) {
      tier = RetentionTiers.TRAILS;
      type = 'trace';
    }
    // 3. Swarm Evolution (Gaps/Reputation)
    else if (upperCategory === 'GAPS' || upperCategory === 'GAP') {
      tier = RetentionTiers.EVOLUTION;
      type = 'GAP';
    } else if (upperCategory === 'REPUTATION' || userId.startsWith(MEMORY_KEYS.REPUTATION_PREFIX)) {
      tier = RetentionTiers.SWARM;
      type = 'REPUTATION';
    }
    // 4. Interaction Lifecycle (Sessions/Summaries)
    else if (upperCategory === 'SESSIONS' || upperCategory === 'SESSION') {
      tier = RetentionTiers.SESSIONS;
      type = 'SESSION';
    } else if (
      upperCategory === 'SUMMARIES' ||
      upperCategory === 'SUMMARY' ||
      userId.startsWith(MEMORY_KEYS.SUMMARY_PREFIX)
    ) {
      tier = RetentionTiers.SUMMARIES;
      type = 'SUMMARY';
    }
    // 5. Ephemeral/Temporary
    else if (userId.startsWith('TEMP#') || upperCategory === 'EPHEMERAL') {
      tier = RetentionTiers.EPHEMERAL;
      type = 'temp';
    }

    const days = await AgentRegistry.getRetentionDays(tier as keyof typeof RETENTION);
    const expiresAt = Math.floor(Date.now() / TIME.MS_PER_SECOND) + days * TIME.SECONDS_IN_DAY;

    return { expiresAt, type };
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
