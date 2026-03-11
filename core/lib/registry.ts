import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { IAgentConfig, AgentType } from './types/agent';
import { MANAGER_SYSTEM_PROMPT } from '../agents/manager';
import { logger } from './logger';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

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
    // 1. Check Backbone first
    if (this.backboneConfigs[id]) {
      // Allow DDB to override parts of backbone config (like model)
      const ddbConfig = await this.getFromDDB();
      if (ddbConfig[id]) {
        return { ...this.backboneConfigs[id], ...ddbConfig[id] };
      }
      return this.backboneConfigs[id];
    }

    // 2. Check User-defined from DDB
    const ddbConfig = await this.getFromDDB();
    return ddbConfig[id];
  }

  static async getAllConfigs(): Promise<Record<string, IAgentConfig>> {
    const ddbConfig = await this.getFromDDB();
    return { ...this.backboneConfigs, ...ddbConfig };
  }

  private static async getFromDDB(): Promise<Record<string, IAgentConfig>> {
    try {
      const { Item } = await docClient.send(
        new GetCommand({
          TableName: (Resource as unknown as { ConfigTable: { name: string } }).ConfigTable.name,
          Key: { key: 'agents_config' },
        })
      );
      return Item?.value || {};
    } catch (e) {
      logger.warn('Failed to fetch agents_config from DDB:', e);
      return {};
    }
  }

  static async saveConfig(id: string, config: IAgentConfig): Promise<void> {
    const all = await this.getFromDDB();
    all[id] = config;

    await docClient.send(
      new PutCommand({
        TableName: (Resource as unknown as { ConfigTable: { name: string } }).ConfigTable.name,
        Item: { key: 'agents_config', value: all },
      })
    );
  }
}
