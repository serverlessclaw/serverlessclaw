import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { IAgentConfig } from './types/agent';
import { BACKBONE_REGISTRY } from './backbone';
import { logger } from './logger';
import { SSTResource, Topology, TopologyNode } from './types/index';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const typedResource = Resource as unknown as SSTResource;

/**
 * AgentRegistry handles discovery and configuration of agents.
 * It combines hardcoded backbone agents with user-defined agents from DDB.
 */
export class AgentRegistry {
  private static backboneConfigs: Record<string, IAgentConfig> = BACKBONE_REGISTRY;
  private static DEFAULT_AGENT_TOOLS = ['recall_knowledge', 'list_agents', 'dispatch_task'];

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

      // Apply overrides from agents_config (This allows hot-swapping prompts/models for backbone agents)
      const ddbAgents =
        ((await this.getRawConfig('agents_config')) as Record<string, Partial<IAgentConfig>>) || {};
      if (ddbAgents[id]) {
        if (ddbAgents[id].systemPrompt) config.systemPrompt = ddbAgents[id].systemPrompt!;
        if (ddbAgents[id].description) config.description = ddbAgents[id].description;
        if (ddbAgents[id].model) config.model = ddbAgents[id].model;
        if (ddbAgents[id].provider) config.provider = ddbAgents[id].provider;
        if (ddbAgents[id].enabled !== undefined) config.enabled = ddbAgents[id].enabled;
      }
    } else {
      // User-defined from DDB
      const ddbAgents =
        ((await this.getRawConfig('agents_config')) as Record<string, unknown>) || {};
      config = ddbAgents[id] as IAgentConfig;
    }

    if (!config) return undefined;

    // 2. Resolve Tool Overrides (Higher Priority)
    // This unifies the manage_agent_tools logic which saves to ${id}_tools
    const toolOverride = await this.getRawConfig(`${id}_tools`);
    if (toolOverride && Array.isArray(toolOverride)) {
      logger.info(`Applying dynamic tool override for agent ${id}:`, toolOverride);
      config.tools = toolOverride;
    } else if (!config.tools || config.tools.length === 0) {
      // Inject standard support profile if no tools are defined
      config.tools = [...AgentRegistry.DEFAULT_AGENT_TOOLS];
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
      const mergedConfig = {
        isBackbone: false, // Default for dynamic agents
        ...all[id],
        ...config,
      };

      // Inject defaults if still missing tools after merge
      if (!mergedConfig.tools || mergedConfig.tools.length === 0) {
        mergedConfig.tools = [...AgentRegistry.DEFAULT_AGENT_TOOLS];
      }

      all[id] = mergedConfig;
    }

    return all;
  }

  /**
   * Retrieves infrastructure configurations from the ConfigTable.
   *
   * @returns A promise that resolves to an array of infrastructure node objects.
   */
  static async getInfraConfig(): Promise<TopologyNode[]> {
    const ddbConfig = await this.getRawConfig('infra_config');
    return Array.isArray(ddbConfig) ? (ddbConfig as TopologyNode[]) : [];
  }

  /**
   * Retrieves the full system topology (nodes + edges).
   */
  static async getFullTopology(): Promise<Topology | undefined> {
    const topology = await this.getRawConfig('system_topology');
    return topology as Topology | undefined;
  }

  /**
   * Fetches a raw value from the ConfigTable by key.
   *
   * @param key - The key to fetch from the ConfigTable.
   * @returns A promise that resolves to the value associated with the key, or undefined.
   */
  public static async getRawConfig(key: string): Promise<unknown> {
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
    const all = ((await this.getRawConfig('agents_config')) as Record<string, unknown>) || {};
    all[id] = config;

    await docClient.send(
      new PutCommand({
        TableName: typedResource.ConfigTable.name,
        Item: { key: 'agents_config', value: all },
      })
    );
  }
}
