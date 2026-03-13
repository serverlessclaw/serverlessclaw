import { IToolDefinition } from './types/tool';
import { AgentRegistry } from './registry';
import { logger } from './logger';

/**
 * SkillRegistry handles dynamic discovery and loading of agent capabilities.
 * It moves beyond static tool registration to a "Just-in-Time" capabilities model.
 */
export class SkillRegistry {
  /**
   * Discovers relevant skills based on a semantic query or category.
   * This allows agents to find tools they need without them being in the initial context.
   */
  static async discoverSkills(query: string, _category?: string): Promise<IToolDefinition[]> {
    const { tools } = await import('../tools/index');
    const { MCPBridge } = await import('./mcp');

    // 1. Get all local tools
    const allLocalTools = Object.values(tools);

    // 2. Get all external MCP tools
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
      }));
  }

  /**
   * Dynamically "installs" a skill for a specific agent session.
   * This can be used to temporarily expand an agent's capability without permanent config changes.
   */
  static async installSkill(agentId: string, skillName: string): Promise<void> {
    const currentConfig = await AgentRegistry.getAgentConfig(agentId);
    if (!currentConfig) throw new Error(`Agent ${agentId} not found`);

    const tools = currentConfig.tools || [];
    if (!tools.includes(skillName)) {
      await AgentRegistry.saveRawConfig(`${agentId}_tools`, [...tools, skillName]);
      logger.info(`Skill '${skillName}' installed for agent ${agentId}`);
    }
  }
}
