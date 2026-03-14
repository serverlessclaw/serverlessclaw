import { logger } from '../logger';
import { ConfigManager } from '../registry/config';
import { RETENTION, TIME } from '../constants';

/**
 * Retention IDs for different system logs based on 2026 usage patterns.
 */
export enum RetentionTiers {
  STANDARD = 'MESSAGES_DAYS',
  CRITICAL = 'LESSONS_DAYS',
  EPHEMERAL = 'SESSIONS_DAYS',
  TRAILS = 'TRACES_DAYS',
}

/**
 * RetentionManager centralizes logic for system data aging and TTL.
 */
export class RetentionManager {
  /**
   * Resolves the TTL timestamp and type for a specific memory category.
   */
  static async getExpiresAt(
    category: string,
    userId: string = ''
  ): Promise<{ expiresAt: number; type: string }> {
    const { AgentRegistry } = await import('../registry');

    let tier = RetentionTiers.STANDARD;
    let type = 'msg';

    const upperCategory = category.toUpperCase();

    if (
      upperCategory === 'LESSONS' ||
      upperCategory === 'LESSON' ||
      upperCategory === 'IMPORTANT'
    ) {
      tier = RetentionTiers.CRITICAL;
      type = 'lesson';
    } else if (
      upperCategory === 'TRACE' ||
      upperCategory === 'TRAILS' ||
      upperCategory === 'TRACES'
    ) {
      tier = RetentionTiers.TRAILS;
      type = 'trace';
    } else if (userId.startsWith('TEMP#') || upperCategory === 'EPHEMERAL') {
      tier = RetentionTiers.EPHEMERAL;
      type = 'temp';
    }

    const days = await AgentRegistry.getRetentionDays(tier as keyof typeof RETENTION);
    const expiresAt = Math.floor(Date.now() / TIME.MS_PER_SECOND) + days * TIME.SECONDS_IN_DAY;

    return { expiresAt, type };
  }

  /**
   * Cleans up transient or failed states from the system.
   */
  static async performSystemCleanup(): Promise<void> {
    try {
      await ConfigManager.saveRawConfig('consecutive_build_failures', 0);
    } catch {
      logger.error('Failed to reset build failure counter');
    }
  }
}
