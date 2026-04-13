import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { IAgentConfig } from '../types/agent';
import { BACKBONE_REGISTRY } from '../backbone';
import { logger } from '../logger';
import type { Topology, TopologyNode } from '../types/index';
import { DYNAMO_KEYS, RETENTION, TOOLS, UNIVERSAL_SYSTEM_TOOLS } from '../constants';
import { ConfigManager, defaultDocClient } from './config';

/**
 * AgentRegistry handles discovery and configuration of agents.
 * It combines hardcoded backbone agents with user-defined agents from DynamoDB.
 */
export class AgentRegistry {
  private static _backboneConfigs: Record<string, IAgentConfig> | null = null;
  private static _essentialTools: string[] | null = null;

  private static get backboneConfigs(): Record<string, IAgentConfig> {
    if (!this._backboneConfigs) {
      this._backboneConfigs = BACKBONE_REGISTRY;
    }
    return this._backboneConfigs;
  }

  private static get essentialTools(): string[] {
    if (!this._essentialTools) {
      this._essentialTools = [...UNIVERSAL_SYSTEM_TOOLS, TOOLS.dispatchTask];
    }
    return this._essentialTools;
  }

  /**
   * Delegates raw config operations to ConfigManager.
   */
  public static getRawConfig = ConfigManager.getRawConfig;
  public static saveRawConfig = ConfigManager.saveRawConfig;
  public static getAgentOverrideConfig = ConfigManager.getAgentOverrideConfig;
  public static incrementConfig = ConfigManager.incrementConfig;

  /**
   * Retrieves the retention period in days for a specific item type.
   *
   * @param item - The key for the retention setting (e.g., MESSAGES_DAYS).
   * @returns A promise resolving to the number of retention days.
   */
  static async getRetentionDays(item: keyof typeof RETENTION): Promise<number> {
    const config = (await ConfigManager.getRawConfig(DYNAMO_KEYS.RETENTION_CONFIG)) as Record<
      string,
      number
    >;
    return config?.[item] ?? RETENTION[item];
  }

  /**
   * Retrieves the configuration for a specific agent by ID.
   *
   * @param id - The unique agent identifier.
   * @param preFetchedConfigs - Optional pre-fetched configurations to avoid redundant DB calls.
   * @returns A promise resolving to the agent configuration or undefined.
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
        (preFetchedConfigs?.[DYNAMO_KEYS.AGENTS_CONFIG] as Record<string, Partial<IAgentConfig>>) ??
        ((await ConfigManager.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG)) as Record<
          string,
          Partial<IAgentConfig>
        >) ??
        {};
      if (ddbAgents[id]) Object.assign(config, ddbAgents[id]);
    } else {
      const ddbAgents =
        (preFetchedConfigs?.[DYNAMO_KEYS.AGENTS_CONFIG] as Record<string, unknown>) ??
        ((await ConfigManager.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG)) as Record<
          string,
          unknown
        >) ??
        {};
      config = ddbAgents[id] as IAgentConfig;
    }

    if (!config) return undefined;

    // 2. Resolve evolutionMode (HITL default)
    const { EvolutionMode } = await import('../types/agent');
    config.evolutionMode = config.evolutionMode ?? EvolutionMode.HITL;

    // 3. Tool Overrides (with TTL Support)
    // Support both per-agent `${id}_tools` entries and the newer batch
    // `DYNAMO_KEYS.AGENT_TOOL_OVERRIDES` map. Batch overrides take precedence
    // and are merged with per-agent overrides when present.
    const batchOverrides =
      (preFetchedConfigs?.[DYNAMO_KEYS.AGENT_TOOL_OVERRIDES] as Record<string, unknown[]>) ??
      ((await ConfigManager.getRawConfig(DYNAMO_KEYS.AGENT_TOOL_OVERRIDES)) as
        | Record<string, unknown[]>
        | undefined);

    const perAgentOverrides =
      (preFetchedConfigs?.[`${id}_tools`] as Array<
        string | import('../types/agent').InstalledSkill
      >) ??
      ((await ConfigManager.getRawConfig(`${id}_tools`)) as Array<
        string | import('../types/agent').InstalledSkill
      >);

    const now = Date.now();
    const activeOverrides: string[] = [];
    let prunedCount = 0;

    const filterActive = (list: (string | import('../types/agent').InstalledSkill)[]) =>
      list.filter((t) => {
        if (typeof t === 'string') return true;
        if (!t.expiresAt || t.expiresAt > now) return true;
        prunedCount++;
        return false;
      });

    const activeBatch =
      batchOverrides && Array.isArray(batchOverrides[id])
        ? filterActive(batchOverrides[id] as (string | import('../types/agent').InstalledSkill)[])
        : [];
    const activePerAgent = Array.isArray(perAgentOverrides) ? filterActive(perAgentOverrides) : [];

    // Batch overrides take precedence - exclude per-agent tools that duplicate batch tools
    const batchToolNames = new Set(activeBatch.map((t) => (typeof t === 'string' ? t : t.name)));
    const filteredPerAgent = activePerAgent.filter(
      (t) => !batchToolNames.has(typeof t === 'string' ? t : t.name)
    );

    activeOverrides.push(...activeBatch.map((t) => (typeof t === 'string' ? t : t.name)));
    activeOverrides.push(...filteredPerAgent.map((t) => (typeof t === 'string' ? t : t.name)));

    if (prunedCount > 0) {
      logger.info(`[REGISTRY] Pruned ${prunedCount} expired tools for agent ${id}`);

      // Persist pruned lists back to DDB
      if (
        batchOverrides &&
        Array.isArray(batchOverrides[id]) &&
        activeBatch.length < (batchOverrides[id] as unknown[]).length
      ) {
        const update = this.saveRawConfig(DYNAMO_KEYS.AGENT_TOOL_OVERRIDES, {
          ...batchOverrides,
          [id]: activeBatch,
        });
        if (update instanceof Promise) {
          update.catch((e) => logger.error(`Failed to persist pruned batch tools for ${id}:`, e));
        }
      }

      if (Array.isArray(perAgentOverrides) && activePerAgent.length < perAgentOverrides.length) {
        const update = this.saveRawConfig(`${id}_tools`, activePerAgent);
        if (update instanceof Promise) {
          update.catch((e) => logger.error(`Failed to persist pruned tools for ${id}:`, e));
        }
      }
    }

    if (activeOverrides.length > 0) {
      config.tools = Array.from(
        new Set([
          ...activeOverrides,
          ...(this.backboneConfigs[id]?.tools ?? (AgentRegistry.essentialTools as string[])),
        ])
      );
    } else {
      config.tools = Array.from(
        new Set([...(config.tools ?? []), ...AgentRegistry.essentialTools])
      );
    }

    if (!config.tools || config.tools.length === 0)
      config.tools = [...AgentRegistry.essentialTools, TOOLS.listAgents];

    return config;
  }

  /**
   * Retrieves configurations for all registered agents, merging backbone and dynamic configs.
   * This is a heavy operation used primarily for discovery and topology visualization.
   *
   * @returns A promise resolving to a record of all agent configurations.
   */
  static async getAllConfigs(): Promise<Record<string, IAgentConfig>> {
    const [ddbConfig, batchToolOverrides] = await Promise.all([
      ConfigManager.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG),
      ConfigManager.getRawConfig(DYNAMO_KEYS.AGENT_TOOL_OVERRIDES),
    ]);

    const all: Record<string, IAgentConfig> = { ...this.backboneConfigs };
    const dynamicAgents = (ddbConfig as Record<string, unknown>) ?? {};
    const agentIds = Array.from(new Set([...Object.keys(all), ...Object.keys(dynamicAgents)]));

    const preFetchedConfigs: Record<string, unknown> = {
      [DYNAMO_KEYS.AGENTS_CONFIG]: dynamicAgents,
    };

    if (batchToolOverrides && typeof batchToolOverrides === 'object') {
      for (const [id, tools] of Object.entries(batchToolOverrides)) {
        preFetchedConfigs[`${id}_tools`] = tools;
      }
    }

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
   * Includes connection nodes for the bus, storage, and other resources.
   *
   * @returns A promise resolving to an array of topology nodes.
   */
  static async getInfraConfig(): Promise<TopologyNode[]> {
    const ddbConfig = await ConfigManager.getRawConfig(DYNAMO_KEYS.INFRA_CONFIG);
    return Array.isArray(ddbConfig) ? (ddbConfig as TopologyNode[]) : [];
  }

  /**
   * Retrieves the full system topology.
   *
   * @returns A promise resolving to the full system topology or undefined.
   */
  static async getFullTopology(): Promise<Topology | undefined> {
    return (await ConfigManager.getRawConfig(DYNAMO_KEYS.SYSTEM_TOPOLOGY)) as Topology | undefined;
  }

  /**
   * Saves or updates an agent configuration and triggers topology refresh.
   *
   * @param id - The unique agent identifier.
   * @param config - The new agent configuration to save.
   */
  static async saveConfig(id: string, config: Partial<IAgentConfig>): Promise<void> {
    const { ConfigTable } = (await import('sst')).Resource as { ConfigTable?: { name: string } };
    if (!ConfigTable?.name) {
      logger.warn(`ConfigTable not linked. Skipping save for ${id}`);
      return;
    }

    if (!config.name || !config.systemPrompt) {
      throw new Error('Invalid agent configuration: name and systemPrompt are required.');
    }

    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    await defaultDocClient.send(
      new UpdateCommand({
        TableName: ConfigTable.name,
        Key: { key: DYNAMO_KEYS.AGENTS_CONFIG },
        UpdateExpression: 'SET #agents.#id = :config',
        ExpressionAttributeNames: { '#agents': 'value', '#id': id },
        ExpressionAttributeValues: { ':config': config },
      })
    );

    try {
      const { discoverSystemTopology } = await import('../utils/topology');
      const topology = await discoverSystemTopology();
      await defaultDocClient.send(
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
   * Records tool usage atomically in the ConfigTable.
   * Tracks both global tool popularity and per-agent usage stats.
   *
   * @param toolName - The name of the tool used.
   * @param agentId - The ID of the agent that used the tool.
   * @returns A promise that resolves when the usage has been recorded.
   */
  static async recordToolUsage(toolName: string, agentId: string = 'unknown'): Promise<void> {
    const { ConfigTable } = (await import('sst')).Resource as { ConfigTable?: { name: string } };
    if (!ConfigTable?.name) return;

    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const updateUsage = async (key: string) => {
      try {
        await defaultDocClient.send(
          new UpdateCommand({
            TableName: ConfigTable.name,
            Key: { key },
            UpdateExpression:
              'SET #usage.#tool.#count = if_not_exists(#usage.#tool.#count, :zero) + :one, #usage.#tool.#last = :now, #usage.#tool.#first = if_not_exists(#usage.#tool.#first, :now)',
            ExpressionAttributeNames: {
              '#usage': 'value',
              '#tool': toolName,
              '#count': 'count',
              '#last': 'lastUsed',
              '#first': 'firstRegistered',
            },
            ExpressionAttributeValues: { ':one': 1, ':zero': 0, ':now': Date.now() },
          })
        );
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ValidationException') {
          const now = Date.now();
          const toolObj = { count: 1, lastUsed: now, firstRegistered: now };
          try {
            await defaultDocClient.send(
              new UpdateCommand({
                TableName: ConfigTable.name,
                Key: { key },
                UpdateExpression: 'SET #usage.#tool = :toolObj',
                ConditionExpression: 'attribute_not_exists(#usage.#tool)',
                ExpressionAttributeNames: {
                  '#usage': 'value',
                  '#tool': toolName,
                },
                ExpressionAttributeValues: { ':toolObj': toolObj },
              })
            );
          } catch (innerError: unknown) {
            if (innerError instanceof Error && innerError.name === 'ValidationException') {
              try {
                await defaultDocClient.send(
                  new UpdateCommand({
                    TableName: ConfigTable.name,
                    Key: { key },
                    UpdateExpression: 'SET #usage = :rootObj',
                    ConditionExpression: 'attribute_not_exists(#usage)',
                    ExpressionAttributeNames: { '#usage': 'value' },
                    ExpressionAttributeValues: { ':rootObj': { [toolName]: toolObj } },
                  })
                );
              } catch (rootError: unknown) {
                if (
                  rootError instanceof Error &&
                  rootError.name === 'ConditionalCheckFailedException'
                ) {
                  return updateUsage(key);
                }
              }
            } else if (
              innerError instanceof Error &&
              innerError.name === 'ConditionalCheckFailedException'
            ) {
              return updateUsage(key);
            }
          }
        }
      }
    };

    await updateUsage(DYNAMO_KEYS.TOOL_USAGE);
    await updateUsage(`tool_usage_${agentId}`);
  }

  /**
   * Initializes firstRegistered timestamp for tools that have no stats yet.
   * This is used by the pruner to ensure grace periods are respected for never-used tools.
   */
  static async initializeToolStats(toolNames: string[], agentId?: string): Promise<void> {
    const { ConfigTable } = (await import('sst')).Resource as { ConfigTable?: { name: string } };
    if (!ConfigTable?.name || toolNames.length === 0) return;

    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const now = Date.now();

    const keys: string[] = [DYNAMO_KEYS.TOOL_USAGE];
    if (agentId) {
      keys.push(`tool_usage_${agentId}` as string);
    }

    for (const key of keys) {
      for (const toolName of toolNames) {
        try {
          await defaultDocClient.send(
            new UpdateCommand({
              TableName: ConfigTable.name,
              Key: { key },
              UpdateExpression:
                'SET #usage.#tool.#first = if_not_exists(#usage.#tool.#first, :now)',
              ExpressionAttributeNames: {
                '#usage': 'value',
                '#tool': toolName,
                '#first': 'firstRegistered',
              },
              ExpressionAttributeValues: { ':now': now },
            })
          );
        } catch (e) {
          logger.debug(`[REGISTRY] Failed to initialize stats for ${toolName} in ${key}: ${e}`);
        }
      }
    }
  }
  /**
   * Atomically updates a specific field for an agent in the AGENTS_CONFIG map.
   * This avoids race conditions where parallel updates to different agents would
   * overwrite each other.
   *
   * @param id - The unique agent identifier.
   * @param field - The field name to update (e.g., 'trustScore').
   * @param value - The new value for the field.
   * @throws Error if the agent does not exist in the registry
   */
  static async atomicUpdateAgentField(id: string, field: string, value: unknown): Promise<void> {
    const resource = (await import('sst')).Resource as { ConfigTable?: { name: string } };
    if (!resource.ConfigTable?.name) {
      logger.warn(`ConfigTable not linked. Skipping atomic update for ${id}`);
      return;
    }

    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    try {
      await defaultDocClient.send(
        new UpdateCommand({
          TableName: resource.ConfigTable.name,
          Key: { key: DYNAMO_KEYS.AGENTS_CONFIG },
          UpdateExpression: 'SET #val.#id.#field = :value',
          ConditionExpression: 'attribute_exists(#val.#id)',
          ExpressionAttributeNames: {
            '#val': 'value',
            '#id': id,
            '#field': field,
          },
          ExpressionAttributeValues: { ':value': value },
        })
      );
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        (e.name === 'ValidationException' || e.name === 'ConditionalCheckFailedException')
      ) {
        if (!this.backboneConfigs[id]) {
          throw new Error(
            `Agent '${id}' does not exist in registry. Cannot update field '${field}'.`
          );
        }
        try {
          await defaultDocClient.send(
            new UpdateCommand({
              TableName: resource.ConfigTable.name,
              Key: { key: DYNAMO_KEYS.AGENTS_CONFIG },
              UpdateExpression: 'SET #val.#id = :agentObj',
              ConditionExpression: 'attribute_not_exists(#val.#id)',
              ExpressionAttributeNames: {
                '#val': 'value',
                '#id': id,
              },
              ExpressionAttributeValues: { ':agentObj': { [field]: value } },
            })
          );
          return;
        } catch (innerError: unknown) {
          if (innerError instanceof Error && innerError.name === 'ValidationException') {
            try {
              await defaultDocClient.send(
                new UpdateCommand({
                  TableName: resource.ConfigTable.name,
                  Key: { key: DYNAMO_KEYS.AGENTS_CONFIG },
                  UpdateExpression: 'SET #val = :rootObj',
                  ConditionExpression: 'attribute_not_exists(#val)',
                  ExpressionAttributeNames: {
                    '#val': 'value',
                  },
                  ExpressionAttributeValues: { ':rootObj': { [id]: { [field]: value } } },
                })
              );
              return;
            } catch (rootError: unknown) {
              if (
                rootError instanceof Error &&
                rootError.name === 'ConditionalCheckFailedException'
              ) {
                return this.atomicUpdateAgentField(id, field, value);
              }
              logger.error(`Failed to initialize root object for agent ${id}:`, rootError);
              throw rootError;
            }
          }
          if (
            innerError instanceof Error &&
            innerError.name === 'ConditionalCheckFailedException'
          ) {
            return this.atomicUpdateAgentField(id, field, value);
          }
          logger.error(`Failed to initialize nested object for agent ${id}:`, innerError);
          throw innerError;
        }
      }
      logger.error(`Failed to atomically update ${field} for agent ${id}:`, e);
      throw e;
    }
  }

  /**
   * Checks if an agent exists in either the backbone registry or dynamic config.
   * @param id - The agent identifier to check.
   * @returns true if the agent exists, false otherwise.
   */
  static async agentExists(id: string): Promise<boolean> {
    if (this.backboneConfigs[id]) {
      return true;
    }
    const ddbConfig = (await ConfigManager.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG)) as Record<
      string,
      unknown
    > | null;
    return ddbConfig !== null && id in ddbConfig;
  }

  /**
   * Atomically updates a specific field for an agent with a conditional check.
   * This ensures the update only succeeds if the current value matches the expected value,
   * preventing race conditions in read-modify-write scenarios.
   *
   * @param id - The unique agent identifier.
   * @param field - The field name to update (e.g., 'trustScore').
   * @param value - The new value for the field.
   * @param expectedCurrentValue - The value expected to be currently stored (for conditional update).
   * @throws Error if the agent does not exist or conditional check fails.
   */
  static async atomicUpdateAgentFieldWithCondition(
    id: string,
    field: string,
    value: unknown,
    expectedCurrentValue: unknown
  ): Promise<void> {
    const resource = (await import('sst')).Resource as { ConfigTable?: { name: string } };
    if (!resource.ConfigTable?.name) {
      logger.warn(`ConfigTable not linked. Skipping atomic update for ${id}`);
      return;
    }

    const agentExists = await this.agentExists(id);
    if (!agentExists) {
      throw new Error(`Agent '${id}' does not exist in registry. Cannot update field '${field}'.`);
    }

    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    try {
      await defaultDocClient.send(
        new UpdateCommand({
          TableName: resource.ConfigTable.name,
          Key: { key: DYNAMO_KEYS.AGENTS_CONFIG },
          UpdateExpression: 'SET #val.#id.#field = :value',
          ConditionExpression:
            'attribute_not_exists(#val.#id.#field) OR #val.#id.#field = :expected',
          ExpressionAttributeNames: {
            '#val': 'value',
            '#id': id,
            '#field': field,
          },
          ExpressionAttributeValues: {
            ':value': value,
            ':expected': expectedCurrentValue,
          },
        })
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        throw e;
      }
      logger.error(`Failed to atomically update ${field} for agent ${id}:`, e);
      throw e;
    }
  }

  /**
   * Performs metabolic pruning of low-utilization tools.
   * Tools with 0 usage and registered > threshold days ago are removed from agent configs.
   *
   * @param daysThreshold - Days of inactivity before a never-used tool is pruned.
   * @returns A promise resolving to the number of tools pruned.
   */
  static async pruneLowUtilizationTools(daysThreshold: number = 30): Promise<number> {
    const thresholdMs = daysThreshold * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const allConfigs = await this.getAllConfigs();
    const batchOverrides =
      ((await ConfigManager.getRawConfig(DYNAMO_KEYS.AGENT_TOOL_OVERRIDES)) as Record<
        string,
        (string | import('../types/agent').InstalledSkill)[]
      >) ?? {};

    let totalPruned = 0;
    const updatedBatchOverrides = { ...batchOverrides };
    let batchModified = false;

    for (const [agentId, config] of Object.entries(allConfigs)) {
      if (!config.tools) continue;

      // 1. Fetch per-agent usage stats for more accurate pruning
      const usage = (await ConfigManager.getRawConfig(`tool_usage_${agentId}`)) as Record<
        string,
        { count: number; firstRegistered: number }
      >;

      // Only prune dynamic tool overrides, not backbone tools
      const backboneTools =
        (this.backboneConfigs as Record<string, IAgentConfig>)[agentId]?.tools ?? [];
      const dynamicTools = config.tools.filter((t) => !backboneTools.includes(t));

      const pruneTargets = dynamicTools.filter((toolName) => {
        const stats = usage?.[toolName];
        if (!stats) return false; // If no stats yet, it might not have been initialized or used
        return stats.count === 0 && now - stats.firstRegistered > thresholdMs;
      });

      if (pruneTargets.length > 0) {
        // Prune from per-agent overrides
        const perAgentTools = (await ConfigManager.getRawConfig(`${agentId}_tools`)) as Array<
          string | import('../types/agent').InstalledSkill
        >;
        if (Array.isArray(perAgentTools)) {
          const remainingPerAgent = perAgentTools.filter((t) => {
            const name = typeof t === 'string' ? t : t.name;
            return !pruneTargets.includes(name);
          });
          if (remainingPerAgent.length < perAgentTools.length) {
            await ConfigManager.saveRawConfig(`${agentId}_tools`, remainingPerAgent);
            totalPruned += perAgentTools.length - remainingPerAgent.length;
          }
        }

        // Prune from batch overrides
        if (Array.isArray(updatedBatchOverrides[agentId])) {
          const originalCount = updatedBatchOverrides[agentId].length;
          updatedBatchOverrides[agentId] = updatedBatchOverrides[agentId].filter((t) => {
            const name = typeof t === 'string' ? t : t.name;
            return !pruneTargets.includes(name);
          });
          if (updatedBatchOverrides[agentId].length < originalCount) {
            batchModified = true;
            totalPruned += originalCount - updatedBatchOverrides[agentId].length;
          }
        }

        logger.info(`[REGISTRY] Pruned tools from agent ${agentId}: ${pruneTargets.join(', ')}`);
      }
    }

    if (batchModified) {
      await ConfigManager.saveRawConfig(DYNAMO_KEYS.AGENT_TOOL_OVERRIDES, updatedBatchOverrides);
    }

    return totalPruned;
  }
}
