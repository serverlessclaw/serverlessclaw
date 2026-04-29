import { systemSchema as schema } from './schema';
import { PromotionManager } from '../../lib/lifecycle/promotion-manager';
import { getAgentContext } from '../../lib/utils/agent-helpers';

/**
 * Tool for agents to autonomously promote validated capabilities.
 */
export const promoteCapability = {
  ...schema.promoteCapability,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { targetAgentId, toolName, reason, _userId } = args as {
      targetAgentId: string;
      toolName: string;
      reason: string;
      _userId?: string;
    };

    const context = await getAgentContext();
    const scope = (context as { scope?: { workspaceId?: string } }).scope;
    const result = await PromotionManager.promoteCapability(
      targetAgentId,
      toolName,
      reason,
      _userId,
      scope
    );

    if (result.success) {
      return `SUCCESS: ${result.message}`;
    } else {
      return `PROMOTION_DENIED: ${result.message}`;
    }
  },
};
