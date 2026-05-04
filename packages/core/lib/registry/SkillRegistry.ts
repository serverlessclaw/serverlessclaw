/**
 * The SkillRegistry is the central directory for all tools and MCP servers
 * available to the ServerlessClaw agents. It allows for dynamic discovery
 * and just-in-time (JIT) skill acquisition.
 */
import { logger } from '../logger';

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  type: 'TOOL' | 'MCP_SERVER';
  manifestUrl?: string; // For remote discovery
  parameters?: Record<string, unknown>; // For static tool definitions
}

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();

  constructor() {
    // Initial core skills
    this.registerCoreSkills();
  }

  private registerCoreSkills() {
    this.registerSkill({
      id: 'fs-read',
      name: 'FileSystem Reader',
      description: 'Ability to read files within the workspace.',
      type: 'TOOL',
    });
    this.registerSkill({
      id: 'web-search',
      name: 'Web Search',
      description: 'Allows agents to search the web for documentation.',
      type: 'TOOL',
    });
  }

  public registerSkill(skill: SkillDefinition) {
    this.skills.set(skill.id, skill);
    logger.info(`[SkillRegistry] Registered skill: ${skill.id}`);
  }

  public getSkill(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  public listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * Discovers new skills from a remote manifest or an injected plugin.
   */
  public async discoverRemoteSkills(manifestUrl: string): Promise<void> {
    try {
      const response = await fetch(manifestUrl);
      const manifest = (await response.json()) as { skills: SkillDefinition[] };
      manifest.skills.forEach((skill) => this.registerSkill(skill));
    } catch (err) {
      logger.error(`[SkillRegistry] Failed to discover remote skills:`, err);
    }
  }
}

export const globalSkillRegistry = new SkillRegistry();
