import { IToolDefinition } from './types/tool';
import { AgentRegistry } from './registry';
import { logger } from './logger';
import { DYNAMO_KEYS } from './constants';

/**
 * SkillRegistry handles dynamic discovery and loading of agent capabilities.
 * It moves beyond static tool registration to a "Just-in-Time" capabilities model.
 * Verified and updated on 3/19/2026.
 */
export class SkillRegistry {
  /**
   * Discovers relevant skills based on a semantic query or category.
   * This allows agents to find tools they need without them being in the initial context.
   */
  static async discoverSkills(query: string, _category?: string): Promise<IToolDefinition[]> {
    const { TOOLS } = await import('../tools/index');
    const { MCPBridge } = await import('./mcp');

    const allLocalTools = Object.values(TOOLS);
    const allExternalTools = await MCPBridge.getExternalTools();

    const allCapabilities = [...allLocalTools, ...allExternalTools];
    const searchTerms = query.toLowerCase().split(' ');

    return allCapabilities
      .filter((tool) => {
        const desc = tool.description.toLowerCase();
        const name = tool.name.toLowerCase();
        return searchTerms.some((term) => desc.includes(term) || name.includes(term));
      })
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        argSchema: (tool as any).argSchema,
        type: tool.type,
        connectionProfile: (tool as any).connectionProfile,
        connector_id: (tool as any).connector_id,
        auth: (tool as any).auth,
        requiresApproval: (tool as any).requiresApproval,
        requiredPermissions: (tool as any).requiredPermissions,
      }));
  }

  /**
   * Dynamically "installs" a skill for a specific agent session.
   * Uses batch tool overrides for efficiency.
   *
   * @param agentId - The ID of the agent receiving the skill.
   * @param skillName - The name of the tool/skill to install.
   * @param ttlMinutes - Optional Time-To-Live in minutes. If not provided, the skill is permanent.
   */
  static async installSkill(
    agentId: string,
    skillName: string,
    ttlMinutes?: number
  ): Promise<void> {
    const { ConfigManager } = await import('./registry/config');
    const currentConfig = await AgentRegistry.getAgentConfig(agentId);
    if (!currentConfig) throw new Error(`Agent ${agentId} not found`);

    const batchOverrides =
      ((await ConfigManager.getRawConfig(DYNAMO_KEYS.AGENT_TOOL_OVERRIDES)) as Record<
        string,
        (string | import('./types/agent').InstalledSkill)[]
      >) ?? {};
    const agentOverrides =
      (batchOverrides[agentId] as (string | import('./types/agent').InstalledSkill)[]) ?? [];
    const batchTools = Array.isArray(agentOverrides) ? agentOverrides : [];

    const perAgentTools = Array.isArray(currentConfig.tools) ? currentConfig.tools : [];

    // Check existence across both per-agent and batch overrides
    const exists =
      perAgentTools.some((t) =>
        typeof t === 'string'
          ? t === skillName
          : (t as import('./types/agent').InstalledSkill).name === skillName
      ) ||
      batchTools.some((t) =>
        typeof t === 'string'
          ? t === skillName
          : (t as import('./types/agent').InstalledSkill).name === skillName
      );
    if (exists) return;

    const newTool = ttlMinutes
      ? { name: skillName, expiresAt: Date.now() + ttlMinutes * 60 * 1000 }
      : skillName;

    // Persist batch override (backwards-compatible with new batch model)
    await AgentRegistry.saveRawConfig(DYNAMO_KEYS.AGENT_TOOL_OVERRIDES, {
      ...batchOverrides,
      [agentId]: [...batchTools, newTool],
    });

    // Also persist per-agent tools for compatibility with existing consumers/tests
    await AgentRegistry.saveRawConfig(`${agentId}_tools`, [...perAgentTools, newTool]);

    logger.info(
      `Skill '${skillName}' installed for ${agentId}${ttlMinutes ? ` (Expires in ${ttlMinutes}m)` : ''}`
    );
  }
}
