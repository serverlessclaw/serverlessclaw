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
    const now = Date.now();

    // 1. Fetch global tool usage from DynamoDB
    const toolUsage = (await ConfigManager.getRawConfig(DYNAMO_KEYS.TOOL_USAGE)) as
      | Record<string, { count: number; lastUsed: number }>
      | undefined;

    if (!toolUsage) {
      logger.warn('[PRUNER] No tool usage data found in ConfigTable.');
      return undefined;
    }

    // 2. Identify all registered tool names
    const registeredToolNames = Object.keys(TOOLS);

    // 3. Identify unused tools (those not in toolUsage or lastUsed > threshold)
    const unusedTools: string[] = [];

    for (const name of registeredToolNames) {
      const stats = toolUsage[name];

      // Never used
      if (!stats) {
        // We only prune tools that HAVE been registered for a while.
        // For simplicity, we assume if they are in the registry but have no usage, they might be new or truly unused.
        // We check if they've ever been used.
        unusedTools.push(name);
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
   * Records a prune proposal in the system knowledge as a strategic gap.
   * This allows the swarm to review and potentially act on it.
   */
  public static async recordPruneProposal(proposal: {
    unusedTools: string[];
    thresholdDays: number;
  }): Promise<void> {
    // Use AgentRegistry to record a strategic gap for this proposal
    const gapId = `prune_proposal_${Date.now()}`;

    // We can't use reportGap directly as it's a tool, but we can save it to the config.
    // In many agents, we use a tool for this. But here we are in core lib.

    logger.warn(
      `[PRUNER] PRUNE PROPOSAL GENERATED: ${proposal.unusedTools.length} tools. Reported as system gap.`
    );

    // Actually, we should probably trigger a SYSTEM_AUDIT event or similar.
    // For now, let's just log it and potentially save it to a known config key.
    await ConfigManager.saveRawConfig(`pending_prune_proposal`, {
      ...proposal,
      status: 'PENDING_REVIEW',
      id: gapId,
    });
  }
}
