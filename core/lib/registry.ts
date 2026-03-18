import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { IAgentConfig } from './types/agent';
import { BACKBONE_REGISTRY } from './backbone';
import { logger } from './logger';
import type { Topology, TopologyNode } from './types/index';
import { DYNAMO_KEYS, RETENTION, TOOLS, CONFIG_KEYS } from './constants';
import { ConfigManager, docClient } from './registry/config';

/**
 * AgentRegistry handles discovery and configuration of agents.
 * It combines hardcoded backbone agents with user-defined agents from DynamoDB.
 */
export class AgentRegistry {
  private static backboneConfigs: Record<string, IAgentConfig> = BACKBONE_REGISTRY;

  private static ESSENTIAL_SYSTEM_TOOLS = [
    TOOLS.DISPATCH_TASK,
    TOOLS.RECALL_KNOWLEDGE,
    TOOLS.DISCOVER_SKILLS,
    TOOLS.INSTALL_SKILL,
    TOOLS.SAVE_MEMORY,
    TOOLS.CHECK_CONFIG,
    TOOLS.SET_SYSTEM_CONFIG,
    TOOLS.LIST_SYSTEM_CONFIGS,
    TOOLS.GET_SYSTEM_CONFIG_METADATA,
  ];

  private static DEFAULT_AGENT_TOOLS = [
    ...AgentRegistry.ESSENTIAL_SYSTEM_TOOLS,
    TOOLS.LIST_AGENTS,
    TOOLS.FILE_UPLOAD,
    TOOLS.FILE_DELETE,
    TOOLS.LIST_UPLOADED_FILES,
  ];

  private static DISCOVERY_BOOTLOADER_TOOLS = [
    ...AgentRegistry.ESSENTIAL_SYSTEM_TOOLS,
    TOOLS.LIST_AGENTS,
    TOOLS.SEND_MESSAGE,
  ];

  /**
   * Delegates raw config operations to ConfigManager.
   */
  public static getRawConfig = ConfigManager.getRawConfig;
  public static saveRawConfig = ConfigManager.saveRawConfig;

  /**
   * Retrieves the retention period in days for a specific item type.
   */
  static async getRetentionDays(item: keyof typeof RETENTION): Promise<number> {
    const config = (await this.getRawConfig(DYNAMO_KEYS.RETENTION_CONFIG)) as Record<
      string,
      number
    >;
    return config && config[item] !== undefined ? config[item] : RETENTION[item];
  }

  /**
   * Retrieves the configuration for a specific agent by ID.
   * @param preFetchedConfigs - Optional pre-fetched configurations to avoid redundant DB calls.
   */
  static async getAgentConfig(
    id: string,
    preFetchedConfigs?: Record<string, unknown>
  ): Promise<IAgentConfig | undefined> {
    let config: IAgentConfig | undefined;

    // 1. Resolve Base Config
    if (this.backboneConfigs[id]) {
      config = { ...this.backboneConfigs[id] };
      const ddbAgents =
        (preFetchedConfigs?.[DYNAMO_KEYS.AGENTS_CONFIG] as Record<string, Partial<IAgentConfig>>) ||
        ((await this.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG)) as Record<
          string,
          Partial<IAgentConfig>
        >) ||
        {};
      if (ddbAgents[id]) Object.assign(config, ddbAgents[id]);
    } else {
      const ddbAgents =
        (preFetchedConfigs?.[DYNAMO_KEYS.AGENTS_CONFIG] as Record<string, unknown>) ||
        ((await this.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG)) as Record<string, unknown>) ||
        {};
      config = ddbAgents[id] as IAgentConfig;
    }

    if (!config) return undefined;

    // 2. Discovery Mode Filter
    const isDiscoveryMode =
      preFetchedConfigs?.[CONFIG_KEYS.SELECTIVE_DISCOVERY_MODE] ??
      (await this.getRawConfig(CONFIG_KEYS.SELECTIVE_DISCOVERY_MODE)) === true;

    if (isDiscoveryMode && config.tools) {
      config.tools = config.tools.filter((t: string) =>
        (AgentRegistry.ESSENTIAL_SYSTEM_TOOLS as string[]).includes(t)
      );
      if (config.tools.length < 4) {
        config.tools = Array.from(
          new Set([...config.tools, ...AgentRegistry.DISCOVERY_BOOTLOADER_TOOLS])
        );
      }
    }

    // 3. Tool Overrides
    const toolOverride =
      (preFetchedConfigs?.[`${id}_tools`] as string[]) ||
      ((await this.getRawConfig(`${id}_tools`)) as string[]);

    if (toolOverride && Array.isArray(toolOverride)) {
      config.tools = Array.from(
        new Set([
          ...toolOverride,
          ...(this.backboneConfigs[id]?.tools || AgentRegistry.ESSENTIAL_SYSTEM_TOOLS),
        ])
      );
    } else {
      config.tools = Array.from(
        new Set([...(config.tools || []), ...AgentRegistry.ESSENTIAL_SYSTEM_TOOLS])
      );
    }

    if (!config.tools || config.tools.length === 0)
      config.tools = [...AgentRegistry.DEFAULT_AGENT_TOOLS];

    return config;
  }

  /**
   * Retrieves configurations for all registered agents.
   */
  static async getAllConfigs(): Promise<Record<string, IAgentConfig>> {
    // 1. Batch fetch primary configs
    const [ddbConfig, discoveryMode] = await Promise.all([
      this.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG),
      this.getRawConfig('selective_discovery_mode'),
    ]);

    const all: Record<string, IAgentConfig> = { ...this.backboneConfigs };
    const dynamicAgents = (ddbConfig as Record<string, unknown>) || {};
    const agentIds = Array.from(new Set([...Object.keys(all), ...Object.keys(dynamicAgents)]));

    // 2. Batch fetch tool overrides for all relevant agents
    const overridePromises = agentIds.map(async (id) => ({
      id,
      tools: await this.getRawConfig(`${id}_tools`),
    }));
    const overrides = await Promise.all(overridePromises);

    // 3. Construct pre-fetched config map
    const preFetchedConfigs: Record<string, unknown> = {
      [DYNAMO_KEYS.AGENTS_CONFIG]: dynamicAgents,
      selective_discovery_mode: discoveryMode,
    };
    for (const { id, tools } of overrides) {
      if (tools) preFetchedConfigs[`${id}_tools`] = tools;
    }

    // 4. Resolve all configs using pre-fetched data
    const results = await Promise.all(
      agentIds.map(async (id) => ({
        id,
        config: await this.getAgentConfig(id, preFetchedConfigs),
      }))
    );

    for (const { id, config } of results) {
      if (config) all[id] = config;
    }

    return all;
  }

  /**
   * Retrieves infrastructure configurations from the ConfigTable.
   */
  static async getInfraConfig(): Promise<TopologyNode[]> {
    const ddbConfig = await this.getRawConfig(DYNAMO_KEYS.INFRA_CONFIG);
    return Array.isArray(ddbConfig) ? (ddbConfig as TopologyNode[]) : [];
  }

  /**
   * Retrieves the full system topology.
   */
  static async getFullTopology(): Promise<Topology | undefined> {
    return (await this.getRawConfig(DYNAMO_KEYS.SYSTEM_TOPOLOGY)) as Topology | undefined;
  }

  /**
   * Saves or updates an agent configuration and triggers topology refresh.
   */
  static async saveConfig(id: string, config: IAgentConfig): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { ConfigTable } = (await import('sst')).Resource as any;
    if (!ConfigTable?.name) {
      logger.warn(`ConfigTable not linked. Skipping save for ${id}`);
      return;
    }

    if (!config.name || !config.systemPrompt) {
      throw new Error('Invalid agent configuration: name and systemPrompt are required.');
    }

    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    await docClient.send(
      new UpdateCommand({
        TableName: ConfigTable.name,
        Key: { key: DYNAMO_KEYS.AGENTS_CONFIG },
        UpdateExpression: 'SET #agents.#id = :config',
        ExpressionAttributeNames: { '#agents': 'value', '#id': id },
        ExpressionAttributeValues: { ':config': config },
      })
    );

    try {
      const { discoverSystemTopology } = await import('./utils/topology');
      const topology = await discoverSystemTopology();
      await docClient.send(
        new PutCommand({
          TableName: ConfigTable.name,
          Item: { key: DYNAMO_KEYS.SYSTEM_TOPOLOGY, value: topology },
        })
      );
      logger.info('Topology auto-refreshed after agent save.');
    } catch (e) {
      logger.error('Failed to auto-refresh topology:', e);
    }
  }

  /**
   * Records tool usage atomically.
   */
  static async recordToolUsage(toolName: string, agentId: string = 'unknown'): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { ConfigTable } = (await import('sst')).Resource as any;
    if (!ConfigTable?.name) return;

    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const updateUsage = async (key: string) => {
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: ConfigTable.name,
            Key: { key },
            UpdateExpression:
              'SET #usage.#tool.#count = if_not_exists(#usage.#tool.#count, :zero) + :one, #usage.#tool.#last = :now',
            ExpressionAttributeNames: {
              '#usage': 'value',
              '#tool': toolName,
              '#count': 'count',
              '#last': 'lastUsed',
            },
            ExpressionAttributeValues: { ':one': 1, ':zero': 0, ':now': Date.now() },
          })
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (e.name === 'ValidationException') {
          await this.saveRawConfig(key, { [toolName]: { count: 1, lastUsed: Date.now() } });
        }
      }
    };

    await updateUsage(DYNAMO_KEYS.TOOL_USAGE);
    await updateUsage(`tool_usage_${agentId}`);
  }
}
