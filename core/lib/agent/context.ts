import { IAgentConfig, ReasoningProfile } from '../types/index';
import { SYSTEM } from '../constants';

/**
 * Handles agent self-awareness and prompt context assembly.
 * @since 2026-03-19
 */
export class AgentContext {
  /**
   * Generates the system identity block.
   *
   * @param config - The agent configuration object.
   * @param model - The active model name.
   * @param provider - The active provider name.
   * @param profile - The reasoning profile being used.
   * @param depth - The current recursion depth.
   * @returns A formatted string containing the system identity.
   */
  static getIdentityBlock(
    config: IAgentConfig | undefined,
    model: string,
    provider: string,
    profile: ReasoningProfile,
    depth: number
  ): string {
    return `
      [SYSTEM_IDENTITY]:
      - AGENT_NAME: ${config?.name ?? 'SuperClaw'}
      - AGENT_ID: ${config?.id ?? 'superclaw'}
      - ACTIVE_PROVIDER: ${provider ?? `${SYSTEM.DEFAULT_PROVIDER} (default)`}
      - ACTIVE_MODEL: ${model ?? `${SYSTEM.DEFAULT_MODEL} (default)`}
      - REASONING_PROFILE: ${profile}
      - RECURSION_DEPTH: ${depth}
    `;
  }

  /**
   * Generates the memory index block.
   *
   * @param distilled - The distilled facts string.
   * @param lessonsCount - The number of tactical lessons available.
   * @returns A formatted string containing the memory index.
   */
  static getMemoryIndexBlock(distilled: string, lessonsCount: number): string {
    return `
      [MEMORY_INDEX]:
      - DISTILLED FACTS: ${distilled ? 'Available (load with recallKnowledge)' : 'None'}
      - TACTICAL LESSONS: ${lessonsCount} recent available.
      
      USE 'recallKnowledge' to retrieve details if they are relevant to the user request.
    `;
  }
}
