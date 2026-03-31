import { SafetyPolicy } from '../lib/types/agent';
import { ToolSafetyOverride } from '../lib/safety/safety-limiter';
import { Agent } from '../lib/agent';
import { IMemory } from '../lib/types/memory';
import { IProvider, ReasoningProfile } from '../lib/types/llm';
import { ITool } from '../lib/types/tool';
import { IAgentConfig, SafetyTier } from '../lib/types/agent';
import { SUPERCLAW_SYSTEM_PROMPT } from './prompts/index';
import { SafetyEngine } from '../lib/safety/safety-engine';

export { SUPERCLAW_SYSTEM_PROMPT };

/**
 * SuperClaw Agent.
 * The main orchestrator that handles user commands and delegates tasks.
 */
export class SuperClaw extends Agent {
  /**
   * Shared SafetyEngine instance for granular safety evaluation.
   */
  private static safetyEngine: SafetyEngine = new SafetyEngine();

  constructor(memory: IMemory, provider: IProvider, tools: ITool[], config?: IAgentConfig) {
    super(memory, provider, tools, config?.systemPrompt || SUPERCLAW_SYSTEM_PROMPT, config);
  }

  /**
   * Get the SafetyEngine instance for external configuration.
   */
  static getSafetyEngine(): SafetyEngine {
    return SuperClaw.safetyEngine;
  }

  /**
   * Static method to parse reasoning profile from user text.
   * Handles commands like /deep, /thinking, and /fast.
   *
   * @param text - The raw user input text.
   * @returns An object containing the detected profile and the cleaned text.
   */
  static parseCommand(text: string): { profile?: ReasoningProfile; cleanText: string } {
    if (text.startsWith('/deep ')) {
      return { profile: ReasoningProfile.DEEP, cleanText: text.replace('/deep ', '') };
    }
    if (text.startsWith('/thinking ')) {
      return { profile: ReasoningProfile.THINKING, cleanText: text.replace('/thinking ', '') };
    }
    if (text.startsWith('/fast ')) {
      return { profile: ReasoningProfile.FAST, cleanText: text.replace('/fast ', '') };
    }
    return { cleanText: text };
  }

  /**
   * Checks whether an action requires HITL approval based on granular safety policies.
   *
   * @param agentConfig - The agent configuration.
   * @param actionType - The type of action: 'code_change', 'deployment', 'file_operation', 'shell_command', or 'mcp_tool'.
   * @param context - Optional context including tool name, resource path, etc.
   * @returns Whether approval is required.
   */
  static async requiresApproval(
    agentConfig: IAgentConfig | undefined,
    actionType: 'code_change' | 'deployment' | 'file_operation' | 'shell_command' | 'mcp_tool',
    context?: {
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
    }
  ): Promise<boolean> {
    const result = await SuperClaw.safetyEngine.evaluateAction(agentConfig, actionType, context);
    return result.requiresApproval;
  }

  /**
   * Evaluates an action against granular safety policies and returns detailed result.
   *
   * @param agentConfig - The agent configuration.
   * @param actionType - The type of action.
   * @param context - Optional context including tool name, resource path, etc.
   * @returns Detailed safety evaluation result.
   */
  static async evaluateAction(
    agentConfig: IAgentConfig | undefined,
    actionType: string,
    context?: {
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
    }
  ) {
    return SuperClaw.safetyEngine.evaluateAction(agentConfig, actionType, context);
  }

  /**
   * Configure a custom safety policy for a specific tier.
   *
   * @param tier - The safety tier to configure.
   * @param policy - Partial policy updates.
   */
  static configureSafetyPolicy(tier: SafetyTier, policy: Partial<SafetyPolicy>): void {
    SuperClaw.safetyEngine.updatePolicy(tier, policy);
  }

  /**
   * Set a tool-specific safety override.
   *
   * @param override - The tool safety override configuration.
   */
  static setToolSafetyOverride(override: ToolSafetyOverride): void {
    SuperClaw.safetyEngine.setToolOverride(override);
  }

  /**
   * Get recent safety violations.
   *
   * @param limit - Maximum number of violations to return.
   * @returns Array of safety violations.
   */
  static getSafetyViolations(limit?: number) {
    return SuperClaw.safetyEngine.getViolations(limit);
  }

  /**
   * Get safety statistics.
   *
   * @returns Safety statistics including violation counts by tier and action.
   */
  static getSafetyStats() {
    return SuperClaw.safetyEngine.getStats();
  }
}
