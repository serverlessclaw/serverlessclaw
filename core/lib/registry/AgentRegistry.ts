import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { IAgentConfig, AgentType } from '../types/agent';
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
  private static readonly MAX_INIT_RETRIES = 3;

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
   * Returns the list of standard backbone fallback agents.
   * Used when target agents are disabled or unavailable.
   */
  static getFallbackAgents(): string[] {
    return [AgentType.SUPERCLAW, AgentType.RESEARCHER];
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
    // Batch overrides from DYNAMO_KEYS.AGENT_TOOL_OVERRIDES take precedence.
    const batchOverrides =
      (preFetchedConfigs?.[DYNAMO_KEYS.AGENT_TOOL_OVERRIDES] as Record<string, unknown[]>) ??
      ((await ConfigManager.getRawConfig(DYNAMO_KEYS.AGENT_TOOL_OVERRIDES)) as
        | Record<string, unknown[]>
        | undefined);

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

    activeOverrides.push(...activeBatch.map((t) => (typeof t === 'string' ? t : t.name)));

    if (prunedCount > 0) {
      logger.info(`[REGISTRY] Filtered ${prunedCount} expired tools for agent ${id}`);
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

    // Ensure baseline security tools are always present
    if (!config.tools || config.tools.length === 0)
      config.tools = [...AgentRegistry.essentialTools, TOOLS.listAgents];

    return config;
  }

  /**
   * Retrieves configurations for all registered agents, merging backbone and dynamic configs.
   * Optimized to batch fetch dynamic configs and bypass O(N) database operations.
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
      [DYNAMO_KEYS.AGENT_TOOL_OVERRIDES]: batchToolOverrides,
    };

    // Note: We don't batch fetch `${id}_tools` legacy keys here because they are deprecated
    // and only used as individual agent fallbacks. Most active agents use batch overrides.

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
   * Tracks both global tool popularity and per-workspace/per-agent usage stats.
   *
   * @param toolName - The name of the tool being used.
   * @param agentId - The agent that used the tool (default: 'unknown').
   * @param workspaceId - Optional workspace ID for workspace-scoped tracking.
   */
  static async recordToolUsage(
    toolName: string,
    agentId: string = 'unknown',
    workspaceId?: string
  ): Promise<void> {
    const now = Date.now();
    const stats = { count: 1, lastUsed: now, firstRegistered: now };

    // Ensure tool stats are initialized lazily (both for new tools and existing ones)
    await this.ensureToolStatsInitialized(toolName);

    // Update global usage
    await ConfigManager.atomicUpdateMapEntity(DYNAMO_KEYS.TOOL_USAGE, toolName, stats);

    // Update per-agent usage
    await ConfigManager.atomicUpdateMapEntity(`tool_usage_${agentId}`, toolName, stats);

    // Update per-workspace usage if workspaceId provided
    if (workspaceId) {
      const workspaceUsageKey = `WS#${workspaceId}#${DYNAMO_KEYS.TOOL_USAGE_PREFIX}`;
      await ConfigManager.atomicUpdateMapEntity(workspaceUsageKey, toolName, stats);
    }
  }

  /**
   * Ensures tool stats are initialized for a tool that may not exist yet.
   * Uses if_not_exists to avoid overwriting existing firstRegistered timestamps.
   */
  private static async ensureToolStatsInitialized(toolName: string): Promise<void> {
    const { ConfigTable } = (await import('sst')).Resource as { ConfigTable?: { name: string } };
    if (!ConfigTable?.name) return;

    try {
      const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
      await defaultDocClient.send(
        new UpdateCommand({
          TableName: ConfigTable.name,
          Key: { key: DYNAMO_KEYS.TOOL_USAGE },
          UpdateExpression: 'SET #val.#tool.#first = if_not_exists(#val.#tool.#first, :now)',
          ExpressionAttributeNames: {
            '#val': 'value',
            '#tool': toolName,
            '#first': 'firstRegistered',
          },
          ExpressionAttributeValues: { ':now': Date.now() },
        })
      );
    } catch {
      // Silently ignore - tool usage tracking is best-effort
    }
  }

  /**
   * Initializes firstRegistered timestamp for tools that have no stats yet.
   * This is used by the pruner to ensure grace periods are respected for never-used tools.
   */
  static async initializeToolStats(toolNames: string[]): Promise<void> {
    const { ConfigTable } = (await import('sst')).Resource as { ConfigTable?: { name: string } };
    if (!ConfigTable?.name || toolNames.length === 0) return;

    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const now = Date.now();

    for (const toolName of toolNames) {
      try {
        await defaultDocClient.send(
          new UpdateCommand({
            TableName: ConfigTable.name,
            Key: { key: DYNAMO_KEYS.TOOL_USAGE },
            UpdateExpression: 'SET #usage.#tool.#first = if_not_exists(#usage.#tool.#first, :now)',
            ExpressionAttributeNames: {
              '#usage': 'value',
              '#tool': toolName,
              '#first': 'firstRegistered',
            },
            ExpressionAttributeValues: { ':now': now },
          })
        );
      } catch (e) {
        logger.debug(`[REGISTRY] Failed to initialize stats for ${toolName}: ${e}`);
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
    if (this.backboneConfigs[id]) return; // Cannot update backbone agents via DDB
    await ConfigManager.atomicUpdateMapField(DYNAMO_KEYS.AGENTS_CONFIG, id, field, value);
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
   * Checks if an agent is a backbone (system) agent.
   * @param id - The agent identifier to check.
   * @returns true if the agent is a backbone agent.
   */
  static isBackboneAgent(id: string): boolean {
    return !!this.backboneConfigs[id];
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
    if (this.backboneConfigs[id]) return;

    const agentExists = await this.agentExists(id);
    if (!agentExists) {
      throw new Error(`Agent '${id}' does not exist in registry. Cannot update field '${field}'.`);
    }

    await ConfigManager.atomicUpdateMapFieldWithCondition(
      DYNAMO_KEYS.AGENTS_CONFIG,
      id,
      field,
      value,
      expectedCurrentValue
    );
  }

  /**
   * Atomically adds/subtracts a value for a specific field for an agent in the AGENTS_CONFIG map.
   * Scoped to Principle 13 (Atomic State Integrity).
   *
   * @param id - The unique agent identifier.
   * @param field - The field name to update.
   * @param delta - The amount to add (can be negative).
   * @returns A promise resolving to the new field value.
   */
  static async atomicAddAgentField(id: string, field: string, delta: number): Promise<number> {
    if (this.backboneConfigs[id]) return 0;
    return ConfigManager.atomicAddMapField(DYNAMO_KEYS.AGENTS_CONFIG, id, field, delta);
  }

  /**
   * Performs metabolic pruning of low-utilization tools for a specific workspace.
   * Tools with 0 usage and registered > threshold days ago are removed from agent configs.
   * Scoped to Principle 13 (Atomic State Integrity).
   *
   * @param workspaceId - The workspace identifier to prune tools for. If provided,
   *                      only workspace-scoped agents are pruned. If empty, all agents
   *                      (including backbone) are eligible for pruning.
   * @param daysThreshold - Days of inactivity before a never-used tool is pruned.
   * @returns A promise resolving to the number of tools pruned.
   */
  static async pruneLowUtilizationTools(
    workspaceId?: string,
    daysThreshold: number = 30
  ): Promise<number> {
    const usage = (await ConfigManager.getRawConfig(DYNAMO_KEYS.TOOL_USAGE)) as Record<
      string,
      { count: number; firstRegistered: number }
    >;
    if (!usage) return 0;

    const thresholdMs = daysThreshold * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Filter low-utilization tools globally - tool names don't have workspace prefixes
    // in the TOOL_USAGE map (they're stored as simple names like 'github_createIssue')
    const lowUtilTools = Object.entries(usage)
      .filter(([, stats]) => stats.count === 0 && now - stats.firstRegistered > thresholdMs)
      .map(([name]) => name);

    if (lowUtilTools.length === 0) return 0;

    logger.info(
      `[REGISTRY] Found ${lowUtilTools.length} low-utilization tools for pruning in workspace '${workspaceId || 'all'}'.`
    );

    const allConfigs = await this.getAllConfigs();
    let totalPruned = 0;

    for (const agentId of Object.keys(allConfigs)) {
      // If workspaceId is provided, only prune workspace-scoped agents
      // If workspaceId is empty/undefined, prune all agents including backbone
      if (workspaceId && !agentId.startsWith(`WS#${workspaceId}#`)) continue;

      // Filter tools for this agent that are in the lowUtilTools list
      const config = allConfigs[agentId];
      const pruneTargets = config.tools?.filter((t) => lowUtilTools.includes(t)) ?? [];

      if (pruneTargets.length > 0) {
        // Atomically prune from batch overrides (SHARED MAP - CRITICAL)
        // This solves the race condition of multiple agents being pruned at once.
        await ConfigManager.atomicRemoveFromMap(
          DYNAMO_KEYS.AGENT_TOOL_OVERRIDES,
          agentId,
          pruneTargets
        ).catch((e) =>
          logger.warn(`[REGISTRY] Failed to atomically prune batch tools for ${agentId}:`, e)
        );

        totalPruned += pruneTargets.length;
      }
    }

    return totalPruned;
  }

  /**
   * Atomically prunes a specific tool from an agent's configuration.
   * Handles both standalone legacy keys and shared batch override maps.
   * Scoped to Principle 13 (Atomic State Integrity) and Silo 7 (Metabolism).
   *
   * @param agentId - The unique agent identifier.
   * @param toolName - The name of the tool to prune.
   * @returns A promise resolving to true if any tool was pruned, false otherwise.
   */
  static async pruneAgentTool(agentId: string, toolName: string): Promise<boolean> {
    logger.info(`[REGISTRY] Pruning specific tool '${toolName}' for agent ${agentId}`);
    let pruned = false;

    // Atomically prune from batch shared map (CRITICAL for Principle 13)
    try {
      await ConfigManager.atomicRemoveFromMap(DYNAMO_KEYS.AGENT_TOOL_OVERRIDES, agentId, [
        toolName,
      ]);
      pruned = true;
    } catch (e) {
      logger.warn(
        `[REGISTRY] Failed to atomically prune batch tool '${toolName}' for ${agentId}:`,
        e
      );
    }

    return pruned;
  }
}
