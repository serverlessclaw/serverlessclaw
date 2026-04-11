import { ConfigManager } from '../registry/config';
import { DYNAMO_KEYS } from '../constants';
import { logger } from '../logger';
import { TOOLS } from '../../tools/index';

/**
 * ToolPruner handles identification and proposing removal of redundant or
 * low-utilization tools based on telemetry.
 */
export class ToolPruner {
  /**
   * Generates a "Prune Proposal" identifying tools that have not been used
   * within the threshold period.
   *
   * @returns A promise resolving to a prune proposal object or undefined if no tools to prune.
   */
  public static async generatePruneProposal(): Promise<
    | {
        unusedTools: string[];
        thresholdDays: number;
        lastAudit: number;
      }
    | undefined
  > {
    const isEnabled = await ConfigManager.getTypedConfig('auto_prune_enabled', false);
    if (!isEnabled) {
      logger.info('[PRUNER] Auto-pruning is disabled. Skipping proposal generation.');
      return undefined;
    }

    const thresholdDays = await ConfigManager.getTypedConfig('tool_prune_threshold_days', 30);
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 day grace period for new tools
    const now = Date.now();

    // 1. Fetch global tool usage from DynamoDB
    const toolUsage = (await ConfigManager.getRawConfig(DYNAMO_KEYS.TOOL_USAGE)) as
      | Record<string, { count: number; lastUsed: number; firstRegistered?: number }>
      | undefined;

    if (!toolUsage) {
      logger.warn('[PRUNER] No tool usage data found in ConfigTable.');
      return undefined;
    }

    // 2. Identify all registered tool names from the hardcoded registry
    const registeredToolNames = Object.keys(TOOLS);

    // 3. Identify unused tools
    const unusedTools: string[] = [];

    for (const name of registeredToolNames) {
      const stats = toolUsage[name];

      // If no stats, it hasn't been used yet. We assume it's new and skip pruning.
      if (!stats) {
        continue;
      }

      // Check grace period
      const firstRegistered = stats.firstRegistered || stats.lastUsed;
      if (now - firstRegistered < GRACE_PERIOD_MS) {
        logger.debug(`[PRUNER] Skipping ${name} - still in grace period.`);
        continue;
      }

      // Stale usage
      if (now - stats.lastUsed > thresholdMs) {
        unusedTools.push(name);
      }
    }

    if (unusedTools.length === 0) {
      logger.info('[PRUNER] No unused tools identified for pruning.');
      return undefined;
    }

    logger.info(`[PRUNER] Identified ${unusedTools.length} unused tools for pruning.`);

    return {
      unusedTools,
      thresholdDays,
      lastAudit: now,
    };
  }

  /**
   * Records a prune proposal in the system knowledge as a strategic improvement.
   * This allows the Strategic Planner to review and potentially act on it.
   */
  public static async recordPruneProposal(
    proposal: {
      unusedTools: string[];
      thresholdDays: number;
    },
    memory?: any // Accepting memory instance
  ): Promise<void> {
    const gapId = `prune_proposal_${Date.now()}`;

    logger.warn(
      `[PRUNER] PRUNE PROPOSAL GENERATED: ${proposal.unusedTools.length} tools. Reporting as system improvement.`
    );

    // Persist to config for backward compatibility/dashboard
    await ConfigManager.saveRawConfig(`pending_prune_proposal`, {
      ...proposal,
      status: 'PENDING_REVIEW',
      id: gapId,
    });

    // Record as a SYSTEM_IMPROVEMENT insight if memory is provided
    if (memory && typeof memory.addMemory === 'function') {
      try {
        const { InsightCategory } = await import('../types/memory');
        await memory.addMemory(
          'system',
          InsightCategory.SYSTEM_IMPROVEMENT,
          `Tool Pruning Proposal: Identified ${proposal.unusedTools.length} tools for removal due to low utilization (>${proposal.thresholdDays} days). Tools: ${proposal.unusedTools.join(', ')}`,
          {
            impact: 4,
            urgency: 2,
            priority: 3,
            tags: ['scythe', 'bloat-reduction'],
          }
        );
        logger.info('[PRUNER] Prune proposal recorded as system improvement memory.');
      } catch (e) {
        logger.error('[PRUNER] Failed to record prune proposal in memory:', e);
      }
    }
  }
}
