import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { IAgentConfig, AgentType } from './types/agent';
import { SUPERCLAW_SYSTEM_PROMPT } from '../agents/superclaw';
import { logger } from './logger';
import { SSTResource } from './types/index';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const typedResource = Resource as unknown as SSTResource;

/**
 * AgentRegistry handles discovery and configuration of agents.
 * It combines hardcoded backbone agents with user-defined agents from DDB.
 */
export class AgentRegistry {
  private static backboneConfigs: Record<string, IAgentConfig> = {
    [AgentType.MAIN]: {
      id: AgentType.MAIN,
      name: 'SuperClaw',
      systemPrompt: SUPERCLAW_SYSTEM_PROMPT,
      description:
        'SuperClaw. Processes input, retrieves long-term memory, and decides when to delegate tasks to spokes.',
      icon: 'Bot',
      enabled: true,
      isBackbone: true,
      tools: ['dispatch_task', 'recall_knowledge', 'switch_model', 'check_health', 'manage_gap'],
    },
    [AgentType.CODER]: {
      id: AgentType.CODER,
      name: 'Coder Agent',
      systemPrompt: `You are a specialized Coder Agent for the Serverless Claw stack. 
      Your mission: Implement requested code/infra changes with 100% safety.
      DOCUMENTATION HUB: Always load 'INDEX.md' first to find the relevant spoke document before making changes.
      CRITICAL RULES:
      1. PRE-FLIGHT CHECK: After writing files, you MUST call 'validate_code' to ensure no lint/build errors.
      2. PERSISTENCE: After a successful 'validate_code', you MUST call 'stage_changes' with the list of files you modified.
      3. PROTECTED FILES: If 'file_write' returns PERMISSION_DENIED, do NOT try to bypass it. 
      4. ATOMICITY: Do not leave the codebase in a broken state. 
      6. KEEP IT VERY CONCISE. It should be only an explanation without the plan.`,
      description:
        'Specialised agent that performs heavy lifting like writing code, modifying infra, and triggering builds.',
      icon: 'Code',
      enabled: true,
      isBackbone: true,
      tools: ['file_write', 'validate_code', 'stage_changes', 'trigger_deployment', 'run_tests'],
    },
    [AgentType.QA]: {
      id: AgentType.QA,
      name: 'QA Auditor',
      systemPrompt: `You are the specialized QA Auditor for the Serverless Claw stack.
      Your mission: Verify that recently implemented changes successfully resolve the identified Capability Gaps.
      
      AUDIT PROTOCOL:
      1. REVIEW PLAN: Read the STRATEGIC_PLAN provided by the Planner.
      2. ANALYZE TRACE: Review the conversation or code changes to see if the new capability was used.
      3. VERIFY SATISFACTION: Determine if the original GAP is now filled.
      
      OUTPUT: Return a VERIFICATION_REPORT summary.
      - If satisfied: State "VERIFICATION_SUCCESSFUL".
      - If not: State "REOPEN_REQUIRED" and explain why implementation failed or was incomplete.`,
      description:
        'Verification node. Audits recently deployed code to ensure it actually solves the intended capability gap.',
      icon: 'FlaskConical',
      enabled: true,
      isBackbone: true,
      tools: ['recall_knowledge', 'check_health'],
    },
    [AgentType.COGNITION_REFLECTOR]: {
      id: AgentType.COGNITION_REFLECTOR,
      name: 'Cognition Reflector',
      systemPrompt: `You are the Cognition Reflector. 
      Your mission: Analyze agent traces to distill long-term memory, tactical lessons, and strategic capability gaps.
      Extract:
      1. FACTS: Verified technical or user-specific information.
      2. LESSONS: Tactical advice to avoid repeat mistakes.
      3. GAPS: Functional requirements that currently fail.`,
      description:
        'Cognitive audit node. Distills facts, lessons, and capability gaps from interaction traces.',
      icon: 'Search',
      enabled: true,
      isBackbone: true,
      tools: ['recall_knowledge', 'manage_gap'],
    },
    [AgentType.STRATEGIC_PLANNER]: {
      id: AgentType.STRATEGIC_PLANNER,
      name: 'Strategic Planner',
      systemPrompt: `You are the Strategic Planner.
      Your mission: Analyze the list of Capability Gaps and the Current System Index to prioritize evolution.
      Output a 'STRATEGIC_PLAN' that guides the Coder Agent.`,
      description:
        'Strategic intelligence node. Analyzes capability gaps and designs long-term evolution plans.',
      icon: 'Brain',
      enabled: true,
      isBackbone: true,
      tools: ['recall_knowledge', 'manage_gap', 'dispatch_task'],
    },
  };

  /**
   * Retrieves the configuration for a specific agent by ID.
   *
   * @param id - The unique ID of the agent.
   * @returns A promise that resolves to the agent configuration or undefined if not found.
   */
  static async getAgentConfig(id: string): Promise<IAgentConfig | undefined> {
    let config: IAgentConfig | undefined;

    // 1. Resolve Base Config
    if (this.backboneConfigs[id]) {
      config = { ...this.backboneConfigs[id] };
      // Apply backbone-level overrides from DDB if any
      const ddbAgents = (await this.getRawConfig('agents_config')) || {};
      if (ddbAgents[id]) {
        config = { ...config, ...ddbAgents[id] };
      }
    } else {
      // User-defined from DDB
      const ddbAgents = (await this.getRawConfig('agents_config')) || {};
      config = ddbAgents[id];
    }

    if (!config) return undefined;

    // 2. Resolve Tool Overrides (Higher Priority)
    // This unifies the manage_agent_tools logic which saves to ${id}_tools
    const toolOverride = await this.getRawConfig(`${id}_tools`);
    if (toolOverride && Array.isArray(toolOverride)) {
      logger.info(`Applying dynamic tool override for agent ${id}:`, toolOverride);
      config.tools = toolOverride;
    }

    return config;
  }

  /**
   * Retrieves configurations for all registered agents.
   *
   * @returns A promise that resolves to a record of agent IDs to their configurations.
   */
  static async getAllConfigs(): Promise<Record<string, IAgentConfig>> {
    const ddbConfig = (await this.getRawConfig('agents_config')) || {};
    const all: Record<string, IAgentConfig> = { ...this.backboneConfigs };

    // Merge in DDB agents
    for (const [id, config] of Object.entries(ddbConfig as Record<string, IAgentConfig>)) {
      all[id] = { ...all[id], ...config };
    }

    return all;
  }

  /**
   * Fetches a raw value from the ConfigTable by key.
   *
   * @param key - The key to fetch from the ConfigTable.
   * @returns A promise that resolves to the value associated with the key, or undefined.
   */
  public static async getRawConfig(key: string): Promise<any> {
    try {
      const { Item } = await docClient.send(
        new GetCommand({
          TableName: typedResource.ConfigTable.name,
          Key: { key },
        })
      );
      return Item?.value;
    } catch (e) {
      logger.warn(`Failed to fetch ${key} from DDB:`, e);
      return undefined;
    }
  }

  /**
   * Saves or updates an agent configuration in the ConfigTable.
   *
   * @param id - The unique ID of the agent.
   * @param config - The configuration object to save.
   * @returns A promise that resolves when the configuration is saved.
   */
  static async saveConfig(id: string, config: IAgentConfig): Promise<void> {
    const all = (await this.getRawConfig('agents_config')) || {};
    all[id] = config;

    await docClient.send(
      new PutCommand({
        TableName: typedResource.ConfigTable.name,
        Item: { key: 'agents_config', value: all },
      })
    );
  }
}
