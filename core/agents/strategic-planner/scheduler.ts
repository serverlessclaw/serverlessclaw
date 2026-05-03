import { logger } from '../../lib/logger';
import { AgentType } from '../../lib/types/agent';
import { parseConfigInt } from '../../lib/providers/utils';
import { CONFIG_DEFAULTS } from '../../lib/config/config-defaults';

/**
 * Manages the self-scheduling of proactive strategic reviews.
 *
 * @param userId - The normalized user ID.
 * @param workspaceId - The workspace ID for multi-tenant isolation.
 * @returns A promise resolving when scheduling is complete.
 */
export async function manageProactiveScheduling(
  userId: string,
  workspaceId?: string
): Promise<void> {
  const { extractBaseUserId } = await import('../../lib/utils/agent-helpers');
  const baseUserId = extractBaseUserId(userId);
  try {
    const { DynamicScheduler } = await import('../../lib/lifecycle/scheduler');
    const { AgentRegistry } = await import('../../lib/registry');

    const GOAL_ID = `PLANNER#STRATEGIC_REVIEW#${baseUserId}`;
    const customFreq = await AgentRegistry.getRawConfig('strategic_review_frequency', {
      workspaceId,
    });
    const frequencyHrs = parseConfigInt(
      customFreq,
      CONFIG_DEFAULTS.STRATEGIC_REVIEW_FREQUENCY_HOURS.code
    );

    await DynamicScheduler.ensureProactiveGoal({
      goalId: GOAL_ID,
      agentId: AgentType.STRATEGIC_PLANNER,
      task: 'Proactive Strategic Review',
      userId: userId,
      frequencyHrs,
      metadata: { isProactive: true },
      workspaceId,
    });
  } catch (e) {
    logger.warn(`Failed to manage proactive self-scheduling (WS: ${workspaceId || 'GLOBAL'}):`, e);
  }
}
