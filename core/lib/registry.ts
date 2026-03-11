import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { IAgentConfig, AgentType } from './types/agent';
import { MANAGER_SYSTEM_PROMPT } from '../agents/manager';
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
      name: 'Main Manager',
      systemPrompt: MANAGER_SYSTEM_PROMPT,
      enabled: true,
      isBackbone: true,
      tools: ['dispatch_task', 'recall_knowledge', 'switch_model', 'check_health'],
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
      5. DOCUMENTATION: Update relevant spoke in 'docs/' in the same step.`,
      enabled: true,
      isBackbone: true,
      tools: ['file_write', 'validate_code', 'stage_changes', 'trigger_deployment', 'run_tests'],
    },
  };

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
   */
  private static async getRawConfig(key: string): Promise<any> {
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
