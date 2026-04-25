import { logger } from '../logger';
import { AgentRegistry } from '../registry/AgentRegistry';
import { EvolutionMode, SafetyTier } from '../types/agent';
import { emitEvent } from '../utils/bus';
import { EventType } from '../types/agent';

/**
 * PromotionManager — Capability Graduation Logic
 *
 * Handles the transition of new tools/agents from 'PENDING' (HITL)
 * to 'PROMOTED' (Autonomous) state in the live environment.
 */
export class PromotionManager {
  /**
   * Promotes a specific capability for an agent.
   * Sets safetyTier to PROD and ensures evolutionMode is AUTO if trust is high.
   */
  static async promoteCapability(
    agentId: string,
    toolName: string,
    reason: string,
    scope?: { workspaceId?: string }
  ): Promise<{ success: boolean; message: string }> {
    try {
      const config = await AgentRegistry.getAgentConfig(agentId, scope);
      if (!config) {
        return { success: false, message: `Agent ${agentId} not found.` };
      }

      // 1. Verify requirements
      const trustScore = config.trustScore ?? 0;
      if (trustScore < 90) {
        return {
          success: false,
          message: `Promotion denied: Agent ${agentId} trust score (${trustScore}) below 90.`,
        };
      }

      // 2. Update Tool Registry (Logical Promotion)
      // If the tool is in the list but the agent is in LOCAL tier, we promote the agent's tier for this tool
      // In our current system, tiers are per-agent, not yet per-tool.
      // So we promote the AGENT to PROD tier if they aren't already.

      const updates: any = {};
      let changed = false;

      if (config.safetyTier !== SafetyTier.PROD) {
        updates.safetyTier = SafetyTier.PROD;
        changed = true;
      }

      if (config.evolutionMode !== EvolutionMode.AUTO) {
        updates.evolutionMode = EvolutionMode.AUTO;
        changed = true;
      }

      // If the tool was disabled, enable it
      if (!config.tools?.includes(toolName)) {
        updates.tools = [...(config.tools || []), toolName];
        changed = true;
      }

      if (changed) {
        await AgentRegistry.updateAgentConfig(agentId, updates, scope);
        logger.info(`[PROMOTION] Agent ${agentId} promoted tool ${toolName}. Reason: ${reason}`);

        // 3. Emit Audit Signal
        await emitEvent('promotion.manager', EventType.REPORT_BACK, {
          userId: 'SYSTEM',
          agentId,
          task: `Promotion: Tool ${toolName} activated autonomously.`,
          workspaceId: scope?.workspaceId,
          metadata: { toolName, reason, trustScore },
        });

        return {
          success: true,
          message: `Capability ${toolName} for agent ${agentId} has been promoted to PROD autonomy.`,
        };
      }

      return { success: true, message: `Capability ${toolName} is already fully promoted.` };
    } catch (error: any) {
      logger.error(`[PROMOTION] Failed to promote capability:`, error);
      return { success: false, message: `Internal error during promotion: ${error.message}` };
    }
  }
}
