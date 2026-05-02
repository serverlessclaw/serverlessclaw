import { IAgentConfig, AgentType, EvolutionMode, Topology } from '../types/index';
import { BACKBONE_REGISTRY } from '../backbone';
import { logger } from '../logger';
import { DYNAMO_KEYS, RETENTION, TRUST } from '../constants';
import { ConfigManager } from './config';
import { ToolUsageRegistry } from './ToolUsageRegistry';
import { TrustRegistry } from './TrustRegistry';
import { PruningRegistry } from './PruningRegistry';

/**
 * AgentRegistry handles discovery and configuration of agents.
 * Refactored into a modular architecture to improve maintainability and AI signal clarity.
 */
export class AgentRegistry {
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
    return [AgentType.SUPERCLAW, AgentType.FACILITATOR];
  }

  /**
   * Merges backbone and dynamic configurations with tool overrides.
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

    const toolOverrides = (await ConfigManager.getRawConfig(DYNAMO_KEYS.AGENT_TOOL_OVERRIDES, {
      workspaceId: options?.workspaceId,
    })) as Record<string, (string | { name: string; expiresAt: number })[]>;

    return this.mergeAgentConfig(agentId, dynamicConfig, backboneConfig, toolOverrides?.[agentId]);
  }

  private static mergeAgentConfig(
    agentId: string,
    dynamicConfig?: IAgentConfig,
    backboneConfig?: IAgentConfig,
    toolOverrides?: (string | { name: string; expiresAt: number })[]
  ): IAgentConfig {
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

    if (toolOverrides) {
      const now = Date.now();
      const overrides = toolOverrides
        .map((t) => (typeof t === 'string' ? t : t.expiresAt > now ? t.name : null))
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
    const [dynamicAgents, toolOverrides] = await Promise.all([
      ConfigManager.getRawConfig(DYNAMO_KEYS.AGENTS_CONFIG, options) as Promise<
        Record<string, IAgentConfig>
      >,
      ConfigManager.getRawConfig(DYNAMO_KEYS.AGENT_TOOL_OVERRIDES, options) as Promise<
        Record<string, (string | { name: string; expiresAt: number })[]>
      >,
    ]);

    const all: Record<string, IAgentConfig> = {};
    for (const [id, backboneCfg] of Object.entries(BACKBONE_REGISTRY)) {
      all[id] = this.mergeAgentConfig(id, dynamicAgents?.[id], backboneCfg, toolOverrides?.[id]);
    }
    if (dynamicAgents) {
      for (const [id, dynamicCfg] of Object.entries(dynamicAgents)) {
        if (!all[id]) {
          all[id] = this.mergeAgentConfig(id, dynamicCfg, undefined, toolOverrides?.[id]);
        }
      }
    }
    return all;
  }

  // --- Delegation Methods ---

  static recordToolUsage = ToolUsageRegistry.recordToolUsage.bind(ToolUsageRegistry);
  static initializeToolStats = ToolUsageRegistry.initializeToolStats.bind(ToolUsageRegistry);

  static atomicIncrementTrustScore = TrustRegistry.atomicIncrementTrustScore.bind(TrustRegistry);
  static atomicSetAgentTrustScore = TrustRegistry.atomicSetAgentTrustScore.bind(TrustRegistry);

  static async pruneLowUtilizationTools(
    workspaceId: string = 'default',
    daysThreshold: number = 30
  ): Promise<number> {
    return PruningRegistry.pruneLowUtilizationTools(
      this.getAllConfigs.bind(this),
      this.getAgentConfig.bind(this),
      workspaceId,
      daysThreshold
    );
  }

  // --- Remaining Utilities ---

  static async getFullTopology(): Promise<Topology> {
    const config = await ConfigManager.getRawConfig(DYNAMO_KEYS.SYSTEM_TOPOLOGY);
    if (config && typeof config === 'object' && 'nodes' in config) return config as Topology;
    return { nodes: Array.isArray(config) ? config : [], edges: [] };
  }

  static async disableAgentIfTrustLow(
    agentId: string,
    threshold: number,
    options?: { workspaceId?: string }
  ): Promise<boolean> {
    try {
      await ConfigManager.atomicUpdateMapEntity(
        DYNAMO_KEYS.AGENTS_CONFIG,
        agentId,
        { enabled: false, lastUpdated: new Date().toISOString() },
        {
          workspaceId: options?.workspaceId,
          increments: { version: 1 },
          conditionExpression: '(#val.#id.#trust < :threshold) AND (#val.#id.#enabled <> :false)',
          expressionAttributeNames: { '#trust': 'trustScore', '#enabled': 'enabled' },
          expressionAttributeValues: { ':threshold': threshold, ':false': false },
        }
      );
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        return false; // Condition not met (trust improved or already disabled)
      }
      throw e;
    }
  }

  static async saveConfig(
    agentId: string,
    config: Partial<IAgentConfig>,
    options?: {
      workspaceId?: string;
      conditionExpression?: string;
      expressionAttributeNames?: Record<string, string>;
      expressionAttributeValues?: Record<string, unknown>;
    }
  ): Promise<void> {
    // Only validate if they are explicitly provided in the partial config
    if (config.name === '' || config.systemPrompt === '') {
      throw new Error('Agent name and systemPrompt cannot be empty if provided');
    }
    const existing = await this.getAgentConfig(agentId, options);
    const { hashString } = await import('../utils/crypto');
    const enriched: Record<string, unknown> = {
      ...config,
      lastUpdated: new Date().toISOString(),
    };

    // Prevent wiping existing metadata (Anti-pattern 6: Direct object-level overwrite)
    if (config.metadata !== undefined || config.systemPrompt !== undefined) {
      enriched.metadata = { ...existing?.metadata, ...config.metadata };
      if (config.systemPrompt !== undefined) {
        (enriched.metadata as any).promptHash = hashString(config.systemPrompt);
      }
    }

    const updateOptions: any = {
      increments: { version: 1 },
      workspaceId: options?.workspaceId,
      conditionExpression: options?.conditionExpression,
      expressionAttributeNames: options?.expressionAttributeNames,
      expressionAttributeValues: options?.expressionAttributeValues,
    };

    if (existing && existing.version !== undefined) {
      const versionCondition = '#val.#id.#version = :expectedVersion';
      const versionNames = { '#version': 'version' };
      const versionValues = { ':expectedVersion': existing.version };

      if (updateOptions.conditionExpression) {
        updateOptions.conditionExpression = `(${updateOptions.conditionExpression}) AND (${versionCondition})`;
        updateOptions.expressionAttributeNames = {
          ...updateOptions.expressionAttributeNames,
          ...versionNames,
        };
        updateOptions.expressionAttributeValues = {
          ...updateOptions.expressionAttributeValues,
          ...versionValues,
        };
      } else {
        updateOptions.conditionExpression = versionCondition;
        updateOptions.expressionAttributeNames = versionNames;
        updateOptions.expressionAttributeValues = versionValues;
      }
    }

    try {
      await ConfigManager.atomicUpdateMapEntity(
        DYNAMO_KEYS.AGENTS_CONFIG,
        agentId,
        enriched,
        updateOptions
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        // If it was our custom condition that failed, we might not want to retry
        // But for simplicity, and because we merge existing.version, retry is usually fine
        // unless the custom condition is "fixed" (e.g. trustScore < 20).
        // If trustScore is now 30, retry will again find it is NOT < 20 and fail again or skip.

        logger.warn(
          `[AgentRegistry] Conditional check failed for agent ${agentId}, retrying/skipping...`
        );
        // If it's just a version mismatch, retry.
        // If it's a custom condition, the retry will re-evaluate the logic before calling saveConfig again.
        return this.saveConfig(agentId, config, options);
      }
      throw e;
    }

    try {
      const { discoverSystemTopology } = await import('../utils/topology');
      await ConfigManager.saveRawConfig(
        DYNAMO_KEYS.SYSTEM_TOPOLOGY,
        await discoverSystemTopology(),
        { workspaceId: options?.workspaceId }
      );
    } catch (e) {
      logger.error('Topology refresh failed:', e);
    }
  }

  static async deleteConfig(agentId: string, options?: { workspaceId?: string }): Promise<void> {
    await ConfigManager.deleteConfig(DYNAMO_KEYS.AGENTS_CONFIG, options);
  }

  /**
   * Pass-through to ConfigManager for raw configuration retrieval.
   * @deprecated Use ConfigManager directly for raw configuration.
   */
  static async getRawConfig<T>(
    key: string,
    options?: { workspaceId?: string }
  ): Promise<T | undefined> {
    return (await ConfigManager.getRawConfig(key, options)) as T | undefined;
  }

  /**
   * Pass-through to ConfigManager for raw configuration storage.
   * @deprecated Use ConfigManager directly for raw configuration.
   */
  static async saveRawConfig(
    key: string,
    value: unknown,
    options?: { author?: string; description?: string; workspaceId?: string }
  ): Promise<void> {
    return ConfigManager.saveRawConfig(key, value, options);
  }

  /**
   * Pass-through to ConfigManager for infrastructure configuration.
   * @deprecated Use ConfigManager directly.
   */
  static async getInfraConfig<T>(options?: { workspaceId?: string }): Promise<T | undefined> {
    const config = await ConfigManager.getRawConfig(DYNAMO_KEYS.INFRA_CONFIG, options);
    if (config === undefined) return undefined;
    return (Array.isArray(config) ? config : []) as unknown as T;
  }

  /**
   * Prunes a specific tool from an agent's configuration.
   * @deprecated Move to PruningRegistry.
   */
  static async pruneAgentTool(
    agentId: string,
    toolName: string,
    options?: { workspaceId?: string }
  ): Promise<boolean> {
    try {
      await ConfigManager.atomicRemoveFromMap(
        DYNAMO_KEYS.AGENT_TOOL_OVERRIDES,
        agentId,
        [toolName],
        options
      );
      return true;
    } catch (e) {
      logger.error(`[AgentRegistry] Failed to prune tool ${toolName} from ${agentId}:`, e);
      return false;
    }
  }

  /**
   * Updates an existing agent's configuration.
   * @deprecated Use saveConfig directly.
   */
  static async updateAgentConfig(
    agentId: string,
    updates: Partial<IAgentConfig>,
    options?: { workspaceId?: string }
  ): Promise<void> {
    return this.saveConfig(agentId, updates, options);
  }

  static async getRetentionDays(type: keyof typeof RETENTION): Promise<number> {
    const overrides = (await ConfigManager.getRawConfig(DYNAMO_KEYS.RETENTION_CONFIG)) as Record<
      string,
      number
    >;
    return overrides?.[type] ?? RETENTION[type];
  }
}
