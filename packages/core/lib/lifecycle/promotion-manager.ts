import { logger } from '../logger';
import { AgentRegistry } from '../registry/AgentRegistry';
import { EvolutionMode, SafetyTier } from '../types/agent';
import { emitEvent } from '../utils/bus';
import { EventType } from '../types/agent';
import { MessageRole } from '../types/llm';

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
    userId?: string,
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

      const updates: Partial<import('../types/agent').IAgentConfig> = {};
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

        // 4. Summarize context for collaborations
        if (userId && userId.startsWith('shared#collab#')) {
          try {
            const { getAgentContext } = await import('../utils/agent-helpers');
            const { memory } = await getAgentContext();

            const message = `🚀 **Agent Promotion**\n\nAgent **${agentId}** has autonomously acquired the capability to use \`${toolName}\`.\n\n*Reason*: ${reason}\n*Trust Score*: ${trustScore}\n*Status*: Upgraded to PROD tier (Autonomous Mode)`;

            await memory.addMessage(
              userId,
              {
                role: MessageRole.SYSTEM,
                content: message,
                traceId: `promotion-${Date.now()}`,
                messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
              },
              scope
            );
          } catch (e) {
            logger.warn(`Failed to append promotion summary to collaboration ${userId}:`, e);
          }
        }

        return {
          success: true,
          message: `Capability ${toolName} for agent ${agentId} has been promoted to PROD autonomy.`,
        };
      }

      return { success: true, message: `Capability ${toolName} is already fully promoted.` };
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        return {
          success: false,
          message: 'Promotion conflict: Agent configuration was modified concurrently.',
        };
      }
      logger.error(`[PROMOTION] Failed to promote capability:`, e);
      return {
        success: false,
        message: `Internal error during promotion: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  /**
   * Promotes an agent to AUTO mode globally if their trust score is very high.
   * Fulfills Principle 9: Trust-Driven Mode Shifting.
   * Uses atomic conditional update to prevent race conditions (Anti-Pattern 7).
   */
  static async promoteAgentToAuto(
    agentId: string,
    trustScore: number,
    scope?: { workspaceId?: string }
  ): Promise<boolean> {
    const { TRUST, DYNAMO_KEYS } = await import('../constants/system');
    const { ConfigManager } = await import('../registry/config');

    if (trustScore < TRUST.AUTONOMY_THRESHOLD) return false;

    try {
      // Principle 13: Atomic State Integrity
      await ConfigManager.atomicUpdateMapEntity(
        DYNAMO_KEYS.AGENTS_CONFIG,
        agentId,
        {
          evolutionMode: EvolutionMode.AUTO,
          lastUpdated: new Date().toISOString(),
          lastPromotedAt: new Date().toISOString(),
        },
        {
          workspaceId: scope?.workspaceId,
          increments: { version: 1 },
          conditionExpression:
            'attribute_exists(#val.#id) AND #val.#id.#mode <> :auto AND #val.#id.#trust >= :threshold',
          expressionAttributeNames: {
            '#mode': 'evolutionMode',
            '#trust': 'trustScore',
          },
          expressionAttributeValues: {
            ':auto': EvolutionMode.AUTO,
            ':threshold': TRUST.AUTONOMY_THRESHOLD,
          },
        }
      );

      logger.info(
        `[PROMOTION] Autonomous Mode Shift: Promoted agent ${agentId} to AUTO mode (TrustScore: ${trustScore}, WS: ${scope?.workspaceId || 'GLOBAL'})`
      );

      await emitEvent('promotion.manager', EventType.REPORT_BACK, {
        userId: 'SYSTEM',
        agentId,
        task: `Autonomous Mode Shift: Agent ${agentId} promoted to AUTO mode due to high trust.`,
        workspaceId: scope?.workspaceId,
        metadata: { trustScore, newMode: EvolutionMode.AUTO },
      });

      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        // Already promoted or trust decayed below threshold since last check
        return false;
      }
      logger.error(`[PROMOTION] Failed to autonomously promote agent ${agentId}:`, e);
    }
    return false;
  }
}
