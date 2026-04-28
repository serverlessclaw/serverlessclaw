import { SafetyPolicy } from '../lib/types/agent';
import { ToolSafetyOverride } from '../lib/safety/safety-limiter';
import { Agent } from '../lib/agent';
import { IMemory } from '../lib/types/memory';
import { IProvider, ReasoningProfile } from '../lib/types/llm';
import { ITool } from '../lib/types/tool';
import { IAgentConfig, SafetyTier } from '../lib/types/agent';
import { SafetyEngine } from '../lib/safety/safety-engine';

/**
 * SuperClaw Agent.
 * The main orchestrator that handles user commands and delegates tasks.
 */
export class SuperClaw extends Agent {
  /**
   * SafetyEngine instance for granular safety evaluation.
   */
  public readonly safetyEngine: SafetyEngine;

  constructor(memory: IMemory, provider: IProvider, tools: ITool[], config?: IAgentConfig) {
    super(memory, provider, tools, config!);
    this.safetyEngine = new SafetyEngine();
  }

  /**
   * Static method to parse reasoning profile from user text.
   * Handles commands like /deep, /thinking, and /fast.
   * Also handles approval responses like APPROVE and REJECT.
   *
   * @param text - The raw user input text.
   * @returns An object containing the detected profile and the cleaned text.
   */
  static parseCommand(text: string): {
    profile?: ReasoningProfile;
    cleanText: string;
    command?: string;
  } {
    if (text.startsWith('/deep ')) {
      return { profile: ReasoningProfile.DEEP, cleanText: text.replace('/deep ', '') };
    }
    if (text.startsWith('/thinking ')) {
      return { profile: ReasoningProfile.THINKING, cleanText: text.replace('/thinking ', '') };
    }
    if (text.startsWith('/fast ')) {
      return { profile: ReasoningProfile.FAST, cleanText: text.replace('/fast ', '') };
    }
    const upperText = text.trim().toUpperCase();
    if (upperText === 'APPROVE' || upperText === 'REJECT') {
      return { cleanText: '', command: upperText };
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
  async requiresApproval(
    agentConfig: IAgentConfig | undefined,
    actionType: 'code_change' | 'deployment' | 'file_operation' | 'shell_command' | 'mcp_tool',
    context?: {
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
    }
  ): Promise<boolean> {
    const result = await this.safetyEngine.evaluateAction(agentConfig, actionType, context);
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
  async evaluateAction(
    agentConfig: IAgentConfig | undefined,
    actionType: string,
    context?: {
      toolName?: string;
      resource?: string;
      traceId?: string;
      userId?: string;
    }
  ) {
    return this.safetyEngine.evaluateAction(agentConfig, actionType, context);
  }

  /**
   * Configure a custom safety policy for a specific tier.
   *
   * @param tier - The safety tier to configure.
   * @param policy - Partial policy updates.
   */
  configureSafetyPolicy(tier: SafetyTier, policy: Partial<SafetyPolicy>): void {
    this.safetyEngine.updatePolicy(tier, policy);
  }

  /**
   * Set a tool-specific safety override.
   *
   * @param override - The tool safety override configuration.
   */
  setToolSafetyOverride(override: ToolSafetyOverride): void {
    this.safetyEngine.setToolOverride(override);
  }
}
