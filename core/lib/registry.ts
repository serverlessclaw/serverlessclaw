import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { IAgentConfig } from './types/agent';
import { BACKBONE_REGISTRY } from './backbone';
import { logger } from './logger';
import { SSTResource, Topology, TopologyNode } from './types/index';
import { DYNAMO_KEYS, RETENTION } from './constants';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const typedResource = Resource as unknown as SSTResource;

/**
 * AgentRegistry handles discovery and configuration of agents.
 * It combines hardcoded backbone agents with user-defined agents from DynamoDB.
 */
export class AgentRegistry {
  private static backboneConfigs: Record<string, IAgentConfig> = BACKBONE_REGISTRY;
  private static DEFAULT_AGENT_TOOLS = [
    'recallKnowledge',
    'listAgents',
    'dispatchTask',
    'discoverSkills',
    'fileUpload',
    'fileDelete',
    'listUploadedFiles',
  ];

  /**
   * Retrieves the retention period in days for a specific item type.
   * Checks for overrides in the ConfigTable before falling back to system defaults.
   *
   * @param item - The retention key (from RETENTION constants)
   * @returns The number of days to keep the item.
   */
  static async getRetentionDays(item: keyof typeof RETENTION): Promise<number> {
    const config = (await this.getRawConfig(DYNAMO_KEYS.RETENTION_CONFIG)) as Record<
      string,
      number
    >;
    if (config && config[item] !== undefined) {
      return config[item];
    }
    return RETENTION[item];
  }

  /**
   * Retrieves the configuration for a specific agent by ID.
   * Merges hardcoded backbone defaults with dynamic overrides from DynamoDB.
   *
   * @param id - The unique ID of the agent (e.g., 'main', 'coder').
   * @returns A promise that resolves to the agent configuration or undefined if not found.
   */
  static async getAgentConfig(id: string): Promise<IAgentConfig | undefined> {
    let config: IAgentConfig | undefined;

    // 1. Resolve Base Config
    if (this.backboneConfigs[id]) {
      config = { ...this.backboneConfigs[id] };

      // Apply overrides from agents_config (This allows hot-swapping prompts/models for backbone agents)
      const ddbAgents =
        ((await this.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG)) as Record<
          string,
          Partial<IAgentConfig>
        >) || {};
      if (ddbAgents[id]) {
        if (ddbAgents[id].systemPrompt) config.systemPrompt = ddbAgents[id].systemPrompt!;
        if (ddbAgents[id].description) config.description = ddbAgents[id].description;
        if (ddbAgents[id].model) config.model = ddbAgents[id].model;
        if (ddbAgents[id].provider) config.provider = ddbAgents[id].provider;
        if (ddbAgents[id].enabled !== undefined) config.enabled = ddbAgents[id].enabled;
        if (ddbAgents[id].maxIterations !== undefined)
          config.maxIterations = ddbAgents[id].maxIterations;
        if (ddbAgents[id].parallelToolCalls !== undefined)
          config.parallelToolCalls = ddbAgents[id].parallelToolCalls;
      }
    } else {
      // User-defined from DDB
      const ddbAgents =
        ((await this.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG)) as Record<string, unknown>) || {};
      config = ddbAgents[id] as IAgentConfig;
    }

    if (!config) return undefined;

    // 2. Resolve Tool Overrides (Higher Priority)
    // This unifies the manageAgentTools logic which saves to ${id}_tools
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
    const ddbConfig = (await this.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG)) || {};
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
    const ddbConfig = await this.getRawConfig(DYNAMO_KEYS.INFRA_CONFIG);
    return Array.isArray(ddbConfig) ? (ddbConfig as TopologyNode[]) : [];
  }

  /**
   * Retrieves the full system topology (nodes + edges).
   *
   * @returns A promise that resolves to the system topology or undefined if not recorded.
   */
  static async getFullTopology(): Promise<Topology | undefined> {
    const topology = await this.getRawConfig(DYNAMO_KEYS.SYSTEM_TOPOLOGY);
    return topology as Topology | undefined;
  }

  /**
   * Fetches a raw value from the ConfigTable by key.
   *
   * @param key - The key to fetch from the ConfigTable.
   * @returns A promise that resolves to the value associated with the key, or undefined.
   */
  public static async getRawConfig(key: string): Promise<unknown> {
    if (!typedResource.ConfigTable?.name) {
      logger.warn(`ConfigTable not linked. Skipping fetch for ${key}`);
      return undefined;
    }

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
   * Saves a raw configuration value to the ConfigTable.
   *
   * @param key - The key to save in the ConfigTable.
   * @param value - The value to associate with the key.
   * @returns A promise that resolves when the configuration is saved.
   */
  public static async saveRawConfig(key: string, value: unknown): Promise<void> {
    if (!typedResource.ConfigTable?.name) {
      logger.warn(`ConfigTable not linked. Skipping save for ${key}`);
      return;
    }

    try {
      await docClient.send(
        new PutCommand({
          TableName: typedResource.ConfigTable.name,
          Item: { key, value },
        })
      );
    } catch (e) {
      logger.error(`Failed to save ${key} to DDB:`, e);
      throw e;
    }
  }

  /**
   * Saves or updates an agent configuration in the ConfigTable.
   * Also triggers a topology refresh to ensure the Pulse map is updated.
   *
   * @param id - The unique ID of the agent.
   * @param config - The configuration object to save.
   * @returns A promise that resolves when the configuration is saved.
   */
  static async saveConfig(id: string, config: IAgentConfig): Promise<void> {
    if (!typedResource.ConfigTable?.name) {
      logger.warn(`ConfigTable not linked. Skipping save for ${id}`);
      return;
    }

    // Basic Validation
    if (!config.name || !config.systemPrompt) {
      throw new Error('Invalid agent configuration: name and systemPrompt are required.');
    }

    // Use atomic UpdateCommand to prevent race conditions during concurrent agent saves
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    await docClient.send(
      new UpdateCommand({
        TableName: typedResource.ConfigTable.name,
        Key: { key: DYNAMO_KEYS.AGENTS_CONFIG },
        UpdateExpression: 'SET #agents.#id = :config',
        ExpressionAttributeNames: {
          '#agents': 'value',
          '#id': id,
        },
        ExpressionAttributeValues: {
          ':config': config,
        },
      })
    );

    // Trigger Topology Discovery Refresh
    try {
      const { discoverSystemTopology } = await import('../handlers/monitor');
      const topology = await discoverSystemTopology();
      await docClient.send(
        new PutCommand({
          TableName: typedResource.ConfigTable.name,
          Item: { key: DYNAMO_KEYS.SYSTEM_TOPOLOGY, value: topology },
        })
      );
      logger.info('Topology auto-refreshed after agent save.');
    } catch (e) {
      logger.error('Failed to auto-refresh topology:', e);
    }
  }
}
