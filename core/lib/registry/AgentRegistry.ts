import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { IAgentConfig } from '../types/agent';
import { BACKBONE_REGISTRY } from '../backbone';
import { logger } from '../logger';
import type { Topology } from '../types/index';
import { DYNAMO_KEYS, RETENTION, TRUST } from '../constants';
import { ConfigManager, getDocClient } from './config';
import { getConfigTableName } from '../utils/ddb-client';

/**
 * AgentRegistry handles discovery and configuration of agents.
 * It combines hardcoded backbone agents with user-defined agents from DynamoDB.
 */
export class AgentRegistry {
  private static _backboneConfigs: Record<string, IAgentConfig> | null = null;
  private static readonly MAX_INIT_RETRIES = 3;

  private static get backboneConfigs(): Record<string, IAgentConfig> {
    if (!this._backboneConfigs) {
      this._backboneConfigs = BACKBONE_REGISTRY;
    }
    return this._backboneConfigs;
  }

  /**
   * Checks if an agent ID belongs to the system backbone.
   */
  static isBackboneAgent(agentId: string): boolean {
    return agentId in BACKBONE_REGISTRY;
  }

  /**
   * Returns a list of agents configured as global fallbacks.
   */
  static getFallbackAgents(): string[] {
    return ['superclaw', 'facilitator'];
  }

  /**
   * Fetches the effective retention days for a specific data type.
   */
  static async getRetentionDays(type: keyof typeof RETENTION): Promise<number> {
    const overrides = (await ConfigManager.getRawConfig(DYNAMO_KEYS.RETENTION_CONFIG)) as Record<
      string,
      number
    >;
    return overrides?.[type] ?? RETENTION[type];
  }

  /**
   * Retrieves an agent configuration by ID, merging backbone defaults with DynamoDB overrides.
   */
  static async getAgentConfig(
    agentId: string,
    options?: { workspaceId?: string }
  ): Promise<IAgentConfig | undefined> {
    const agents = (await ConfigManager.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG, options)) as Record<
      string,
      IAgentConfig
    >;
    const dynamicConfig = agents?.[agentId];
    const backboneConfig = BACKBONE_REGISTRY[agentId as keyof typeof BACKBONE_REGISTRY];

    if (!dynamicConfig && !backboneConfig) return undefined;

    const { EvolutionMode } = await import('../types/agent');

    const config: IAgentConfig = {
      evolutionMode: EvolutionMode.HITL,
      trustScore: TRUST.DEFAULT_SCORE,
      tools: [],
      ...backboneConfig,
      ...dynamicConfig,
      id: agentId,
      name: dynamicConfig?.name ?? backboneConfig?.name ?? agentId,
      enabled: dynamicConfig?.enabled ?? backboneConfig?.enabled ?? true,
    };

    // Apply tool overrides (e.g., from metabolic pruning or batch updates)
    const toolOverrides = (await ConfigManager.getRawConfig(DYNAMO_KEYS.AGENT_TOOL_OVERRIDES, {
      workspaceId: options?.workspaceId,
    })) as Record<string, (string | { name: string; expiresAt: number })[]>;

    if (toolOverrides?.[agentId]) {
      const now = Date.now();
      const overrides = toolOverrides[agentId]
        .map((t) => {
          if (typeof t === 'string') return t;
          if (t.expiresAt > now) return t.name;
          return null;
        })
        .filter((t): t is string => t !== null);

      config.tools = Array.from(new Set([...(config.tools || []), ...overrides]));
    }

    return config;
  }

  /**
   * Fetches all registered agent configurations.
   */
  static async getAllConfigs(options?: {
    workspaceId?: string;
  }): Promise<Record<string, IAgentConfig>> {
    const dynamicAgents = (await ConfigManager.getRawConfig(
      DYNAMO_KEYS.AGENTS_CONFIG,
      options
    )) as Record<string, IAgentConfig>;
    const all: Record<string, IAgentConfig> = { ...BACKBONE_REGISTRY };

    if (dynamicAgents) {
      for (const [id, cfg] of Object.entries(dynamicAgents)) {
        all[id] = {
          tools: [],
          ...BACKBONE_REGISTRY[id as keyof typeof BACKBONE_REGISTRY],
          ...cfg,
          id,
          name: cfg.name ?? id,
          enabled: cfg.enabled ?? true,
        };
      }
    }

    return all;
  }

  /**
   * Retrieves the full system infrastructure topology.
   */
  static async getFullTopology(): Promise<Topology> {
    const config = await ConfigManager.getRawConfig(DYNAMO_KEYS.SYSTEM_TOPOLOGY);
    if (config && typeof config === 'object' && 'nodes' in config) {
      return config as Topology;
    }
    if (Array.isArray(config)) {
      return { nodes: config, edges: [] };
    }
    return { nodes: [], edges: [] };
  }

  /**
   * Saves or updates an agent configuration in DynamoDB.
   *
   * Implementing Principle 12 (Cognitive Lineage & Versioning):
   * This method automatically handles:
   * 1. Hashing the systemPrompt to detect behavioral changes.
   * 2. Incrementing the version number atomically.
   * 3. Triggering a topology refresh to update agent roles in the swarm navigation.
   *
   * @param agentId - The unique identifier for the agent.
   * @param config - The partial configuration updates to apply.
   * @throws Error if mandatory fields (name, systemPrompt) are missing during initialization.
   */
  static async saveConfig(agentId: string, config: Partial<IAgentConfig>): Promise<void> {
    const tableName = getConfigTableName();

    if (!tableName) {
      throw new Error('ConfigTable not linked. Cannot save agent configuration.');
    }

    if (!config.name || !config.systemPrompt) {
      throw new Error('Agent configuration must include name and systemPrompt.');
    }

    const { hashString } = await import('../utils/crypto');
    const enrichedConfig: Partial<IAgentConfig> = {
      ...config,
      lastUpdated: new Date().toISOString(),
      metadata: {
        ...config.metadata,
        promptHash: hashString(config.systemPrompt),
      },
    };

    await ConfigManager.atomicUpdateMapEntity(DYNAMO_KEYS.AGENTS_CONFIG, agentId, enrichedConfig);

    // Increment version atomically to track cognitive evolution
    await this.atomicAddAgentField(agentId, 'version', 1).catch(() => {});

    logger.info(`[REGISTRY] Configuration saved for agent: ${agentId}`);

    // Auto-refresh topology to reflect potential role changes
    try {
      const { discoverSystemTopology } = await import('../utils/topology');
      const topology = await discoverSystemTopology();
      await getDocClient().send(
        new PutCommand({
          TableName: tableName,
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
    scope?: {
      workspaceId?: string;
      teamId?: string;
      staffId?: string;
    }
  ): Promise<void> {
    const now = Date.now();

    // Ensure tool stats are initialized lazily (both for new tools and existing ones)
    // and then increment/update usage statistics atomically.
    try {
      // 1. Global usage increment
      await this.atomicRecordToolUsage(DYNAMO_KEYS.TOOL_USAGE, toolName, now);

      // 2. Per-agent usage increment
      await this.atomicRecordToolUsage(`tool_usage_${agentId}`, toolName, now);

      // 3. Per-workspace/org/team/staff usage increment
      if (scope) {
        if (scope.workspaceId) {
          const workspaceUsageKey = `WS#${scope.workspaceId}#${DYNAMO_KEYS.TOOL_USAGE_PREFIX}`;
          await this.atomicRecordToolUsage(workspaceUsageKey, toolName, now);
        }
        if (scope.teamId) {
          const teamUsageKey = `TEAM#${scope.teamId}#${DYNAMO_KEYS.TOOL_USAGE_PREFIX}`;
          await this.atomicRecordToolUsage(teamUsageKey, toolName, now);
        }
        if (scope.staffId) {
          const staffUsageKey = `STAFF#${scope.staffId}#${DYNAMO_KEYS.TOOL_USAGE_PREFIX}`;
          await this.atomicRecordToolUsage(staffUsageKey, toolName, now);
        }
      }
    } catch (e) {
      logger.warn(`[REGISTRY] Failed to record tool usage for ${toolName}:`, e);
    }
  }

  /**
   * Internal helper to atomically record tool usage (increment count + update lastUsed).
   * Scoped to Principle 13 (Atomic State Integrity).
   */
  private static async atomicRecordToolUsage(
    key: string,
    toolName: string,
    timestamp: number
  ): Promise<void> {
    const tableName = getConfigTableName();

    if (!tableName) return;

    try {
      // Try to increment existing stats
      await getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key },
          UpdateExpression:
            'SET #val.#tool.#count = if_not_exists(#val.#tool.#count, :zero) + :one, #val.#tool.#last = :now',
          ConditionExpression: 'attribute_exists(#val.#tool)',
          ExpressionAttributeNames: {
            '#val': 'value',
            '#tool': toolName,
            '#count': 'count',
            '#last': 'lastUsed',
          },
          ExpressionAttributeValues: { ':one': 1, ':zero': 0, ':now': timestamp },
        })
      );
    } catch (e: unknown) {
      // Fallback: tool doesn't exist in map yet, initialize it
      if (
        e instanceof Error &&
        (e.name === 'ConditionalCheckFailedException' || e.name === 'ValidationException')
      ) {
        try {
          await getDocClient().send(
            new UpdateCommand({
              TableName: tableName,
              Key: { key },
              UpdateExpression: 'SET #val.#tool = :newStats',
              ConditionExpression: 'attribute_not_exists(#val.#tool)',
              ExpressionAttributeNames: { '#val': 'value', '#tool': toolName },
              ExpressionAttributeValues: {
                ':newStats': { count: 1, lastUsed: timestamp, firstRegistered: timestamp },
              },
            })
          );
        } catch (innerE) {
          // If map itself doesn't exist, we'd need a root initialization (very rare for TOOL_USAGE)
          logger.debug(`[REGISTRY] Tool initialization failed for ${toolName} in ${key}:`, innerE);
        }
      }
    }
  }

  /**
   * Ensures tool stats are initialized for a tool that may not exist yet.
   * Uses if_not_exists to avoid overwriting existing firstRegistered timestamps.
   */
  private static async ensureToolStatsInitialized(toolName: string): Promise<void> {
    const tableName = getConfigTableName();

    if (!tableName) return;

    const now = Date.now();
    try {
      await getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: DYNAMO_KEYS.TOOL_USAGE },
          UpdateExpression:
            'SET #val.#tool = if_not_exists(#val.#tool, :newStats), #val.#tool.#first = if_not_exists(#val.#tool.#first, :now)',
          ExpressionAttributeNames: {
            '#val': 'value',
            '#tool': toolName,
            '#first': 'firstRegistered',
          },
          ExpressionAttributeValues: {
            ':now': now,
            ':newStats': { count: 0, lastUsed: 0, firstRegistered: now },
          },
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
    const tableName = getConfigTableName();

    if (!tableName || toolNames.length === 0) return;

    for (const toolName of toolNames) {
      await this.ensureToolStatsInitialized(toolName);
    }
  }

  /**
   * Performs metabolic pruning of low-utilization tools for a specific workspace.
   * Tools with 0 usage and registered > threshold days ago are removed from agent configs.
   * Scoped to Principle 13 (Atomic State Integrity).
   *
   * @param workspaceId - The workspace identifier to prune tools for.
   * @param daysThreshold - Days of inactivity before a never-used tool is pruned.
   * @returns A promise resolving to the number of tools pruned.
   */
  static async pruneLowUtilizationTools(
    workspaceId: string = 'default',
    daysThreshold: number = 30
  ): Promise<number> {
    const scope = workspaceId !== 'default' ? { workspaceId } : undefined;
    const usageKey = DYNAMO_KEYS.TOOL_USAGE;

    const usage = (await ConfigManager.getRawConfig(usageKey, scope)) as Record<
      string,
      { count: number; firstRegistered: number }
    >;
    if (!usage) return 0;

    const thresholdMs = daysThreshold * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const lowUtilTools = Object.entries(usage)
      .filter(([, stats]) => stats.count === 0 && now - stats.firstRegistered > thresholdMs)
      .map(([name]) => name);

    if (lowUtilTools.length === 0) return 0;

    const allConfigs = await this.getAllConfigs(scope);
    let totalPruned = 0;

    for (const agentId of Object.keys(allConfigs)) {
      // Fetch the full config which includes applied overrides
      const config = await this.getAgentConfig(agentId, scope);
      if (!config) continue;

      const pruneTargets = config.tools?.filter((t) => lowUtilTools.includes(t)) ?? [];

      if (pruneTargets.length > 0) {
        const overridesKey = DYNAMO_KEYS.AGENT_TOOL_OVERRIDES;

        await ConfigManager.atomicRemoveFromMap(overridesKey, agentId, pruneTargets, scope).catch(
          (e) => logger.warn(`[REGISTRY] Failed to atomically prune batch tools for ${agentId}:`, e)
        );

        totalPruned += pruneTargets.length;
      }
    }

    return totalPruned;
  }

  /**
   * Legacy wrapper for raw configuration fetching.
   * @deprecated Use ConfigManager directly for new code.
   */
  static async getRawConfig(key: string, options?: { workspaceId?: string }): Promise<unknown> {
    return ConfigManager.getRawConfig(key, options);
  }

  /**
   * Legacy wrapper for raw configuration storage.
   * @deprecated Use ConfigManager directly for new code.
   */
  static async saveRawConfig(
    key: string,
    value: unknown,
    options?: { author?: string; description?: string; workspaceId?: string }
  ): Promise<void> {
    return ConfigManager.saveRawConfig(key, value, options);
  }

  /**
   * Atomically updates a specific field for an agent in the AGENTS_CONFIG map.
   * This avoids race conditions where parallel updates to different agents would
   * overwrite each other's configuration data.
   *
   * @param agentId - The ID of the agent to update.
   * @param field - The field name within the agent's configuration object.
   * @param value - The value to add (positive or negative).
   * @param options - Optional configuration (workspaceId).
   * @returns The updated value of the field.
   */
  static async atomicAddAgentField(
    agentId: string,
    field: string,
    value: number,
    options?: { workspaceId?: string }
  ): Promise<number> {
    const tableName = getConfigTableName();

    if (!tableName) {
      throw new Error('ConfigTable not linked. Cannot update agent field.');
    }

    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');

    const effectiveKey = options?.workspaceId
      ? `WS#${options.workspaceId}#${DYNAMO_KEYS.AGENTS_CONFIG}`
      : DYNAMO_KEYS.AGENTS_CONFIG;

    try {
      const response = await getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression:
            'SET #agents.#id.#field = if_not_exists(#agents.#id.#field, :zero) + :val',
          ExpressionAttributeNames: {
            '#agents': 'value',
            '#id': agentId,
            '#field': field,
          },
          ExpressionAttributeValues: {
            ':val': value,
            ':zero': 0,
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      const updatedAgents = response.Attributes?.value as Record<string, Record<string, unknown>>;
      return (updatedAgents?.[agentId]?.[field] as number) ?? 0;
    } catch (e) {
      logger.error(
        `[REGISTRY] Failed to atomically update agent field '${field}' for ${agentId}:`,
        e
      );
      throw e;
    }
  }

  /**
   * Atomically sets the trust score for an agent in the AGENTS_CONFIG map, conditional on the current score.
   * This prevents race conditions where bounded clamps overlap.
   */
  static async atomicSetAgentTrustScore(
    agentId: string,
    expectedOldScore: number,
    newScore: number,
    options?: { workspaceId?: string }
  ): Promise<boolean> {
    const tableName = getConfigTableName();

    if (!tableName) {
      throw new Error('ConfigTable not linked. Cannot update agent field.');
    }

    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');

    const effectiveKey = options?.workspaceId
      ? `WS#${options.workspaceId}#${DYNAMO_KEYS.AGENTS_CONFIG}`
      : DYNAMO_KEYS.AGENTS_CONFIG;

    // We only try to conditionally update if the field exists and matches, OR if the expected old score is 100 (default) and it does not exist.
    let conditionExpression = '#agents.#id.trustScore = :expectedOldScore';
    if (expectedOldScore === 100) {
      conditionExpression =
        '(attribute_not_exists(#agents.#id.trustScore) OR #agents.#id.trustScore = :expectedOldScore)';
    }

    try {
      await getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: 'SET #agents.#id.trustScore = :newScore',
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames: {
            '#agents': 'value',
            '#id': agentId,
          },
          ExpressionAttributeValues: {
            ':newScore': newScore,
            ':expectedOldScore': expectedOldScore,
          },
        })
      );
      return true;
    } catch (e: unknown) {
      const err = e as { name?: string };
      if (err.name === 'ConditionalCheckFailedException' || err.name === 'ValidationException') {
        throw e;
      }
      logger.error(`[REGISTRY] Failed to conditionally set trustScore for ${agentId}:`, e);
      throw e;
    }
  }

  /**
   * Atomically removes a tool from an agent's overrides.
   *
   * @param agentId - The ID of the agent.
   * @param toolName - The tool to remove.
   * @param options - Optional configuration (workspaceId).
   * @returns boolean indicating success.
   */
  static async pruneAgentTool(
    agentId: string,
    toolName: string,
    options?: { workspaceId?: string }
  ): Promise<boolean> {
    let pruned = false;

    const overridesKey = options?.workspaceId
      ? `WS#${options.workspaceId}#${DYNAMO_KEYS.AGENT_TOOL_OVERRIDES}`
      : DYNAMO_KEYS.AGENT_TOOL_OVERRIDES;

    // Prune from batch overrides
    try {
      await ConfigManager.atomicRemoveFromMap(overridesKey, agentId, [toolName]);
      pruned = true;
    } catch (e) {
      logger.warn(
        `[REGISTRY] Failed to atomically prune batch tool '${toolName}' for ${agentId}:`,
        e
      );
    }

    return pruned;
  }

  /**
   * Updates an agent configuration in the ConfigTable.
   *
   * @param agentId - The ID of the agent to update.
   * @param updates - Partial configuration updates to apply.
   * @param options - Optional configuration (workspaceId).
   */
  static async updateAgentConfig(
    agentId: string,
    updates: Partial<IAgentConfig>,
    options?: { workspaceId?: string }
  ): Promise<void> {
    await ConfigManager.atomicUpdateMapEntity(DYNAMO_KEYS.AGENTS_CONFIG, agentId, updates, options);
  }

  /**
   * Atomically increments the trust score for an agent.
   * Implements Principle 15 (Monotonic Progress).
   */
  static async atomicIncrementTrustScore(
    agentId: string,
    delta: number,
    options: { workspaceId?: string; min?: number; max?: number } = {}
  ): Promise<number> {
    return ConfigManager.atomicIncrementMapField(
      DYNAMO_KEYS.AGENTS_CONFIG,
      agentId,
      'trustScore',
      delta,
      options
    );
  }

  /**
   * Gets infrastructure configuration nodes.
   * @deprecated Use ConfigManager.getRawConfig directly.
   */
  static async getInfraConfig(options?: { workspaceId?: string }): Promise<unknown[]> {
    const config = await ConfigManager.getRawConfig('infra_topology', options);
    if (Array.isArray(config)) {
      return config;
    }
    return [];
  }
}
