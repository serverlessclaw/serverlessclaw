import { ConfigManager } from './registry/config';
import { CONFIG_DEFAULTS } from './config/config-defaults';
import { logger } from './logger';
import { TIME } from './constants';

/**
 * Represents a dynamic feature flag configuration.
 * Supports rollout percentages and agent-specific targeting.
 */
export interface FeatureFlag {
  /** Unique identifier for the feature flag */
  name: string;
  /** Overall enabled status */
  enabled: boolean;
  /** Percentage of actors who see the feature (0-100) */
  rolloutPercent: number;
  /** Optional list of agent IDs this flag applies to */
  targetAgents?: string[];
  /** Human-readable explanation of the flag's purpose */
  description: string;
  /** Epoch timestamp when this flag should be automatically pruned */
  expiresAt?: number;
  /** Epoch timestamp when this flag was created */
  createdAt?: number;
}

interface CachedFlag {
  value: FeatureFlag | null;
  expiresAt: number;
}

/**
 * Centralized manager for feature flags and dynamic capability toggling.
 * Implements local caching with TTL to minimize configuration registry overhead.
 */
export class FeatureFlags {
  private static readonly CACHE_TTL_MS = TIME.MS_PER_MINUTE;
  private static readonly FLAG_KEY_PREFIX = 'feature_flag_';
  private static cache = new Map<string, CachedFlag>();

  /**
   * Evaluates if a feature flag is enabled for a specific agent.
   *
   * @param flagName - The name of the flag to check.
   * @param agentId - Optional ID of the agent performing the check.
   * @returns A promise resolving to true if the feature is active for the requester.
   */
  static async isEnabled(
    flagName: string,
    agentId?: string,
    workspaceId?: string
  ): Promise<boolean> {
    try {
      const flagsEnabled = await ConfigManager.getTypedConfig(
        CONFIG_DEFAULTS.FEATURE_FLAGS_ENABLED.configKey!,
        CONFIG_DEFAULTS.FEATURE_FLAGS_ENABLED.code,
        { workspaceId }
      );
      if (!flagsEnabled) return false;
    } catch {
      if (!CONFIG_DEFAULTS.FEATURE_FLAGS_ENABLED.code) return false;
    }

    const flag = await this.getFlag(flagName, workspaceId);
    if (!flag || !flag.enabled) return false;

    if (flag.targetAgents && flag.targetAgents.length > 0) {
      if (!agentId || !flag.targetAgents.includes(agentId)) return false;
    }

    if (flag.rolloutPercent >= 100) return true;
    if (flag.rolloutPercent <= 0) return false;

    const identifier = agentId ?? flagName;
    const hash = this.hashCode(identifier + flagName);
    return hash % 100 < flag.rolloutPercent;
  }

  static async setFlag(flag: FeatureFlag, workspaceId?: string): Promise<void> {
    await ConfigManager.saveRawConfig(`${this.FLAG_KEY_PREFIX}${flag.name}`, flag, {
      author: 'system:feature-flags',
      skipVersioning: true,
      workspaceId,
    });

    try {
      await ConfigManager.atomicAppendToList('feature_flags_list', [flag.name], {
        preventDuplicates: true,
        workspaceId,
      });
    } catch (e) {
      logger.warn(
        `Failed to atomically update feature_flags_list (WS: ${workspaceId || 'GLOBAL'}):`,
        e
      );
    }

    this.cache.delete(this.getCacheKey(flag.name, workspaceId));
  }

  static async listFlags(workspaceId?: string): Promise<FeatureFlag[]> {
    try {
      const rawFlags = await ConfigManager.getTypedConfig('feature_flags_list', [] as string[], {
        workspaceId,
      });
      const flags = await Promise.all(
        rawFlags.map((name: string) => this.getFlag(name, workspaceId))
      );
      return flags.filter((f): f is FeatureFlag => f !== null);
    } catch (error) {
      logger.warn(`Failed to list feature flags (WS: ${workspaceId || 'GLOBAL'}):`, error);
      return [];
    }
  }

  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Prunes stale feature flags that have expired based on expiresAt or age threshold.
   * Supports Silo 7 (Metabolism) autonomous cleanup.
   *
   * @param daysThreshold - Days after creation to consider stale if no expiresAt (default: 30)
   * @returns The number of flags pruned
   */
  static async pruneStaleFlags(daysThreshold: number = 30, workspaceId?: string): Promise<number> {
    const thresholdMs = daysThreshold * TIME.MS_PER_DAY;
    const now = Date.now();

    try {
      const flags = await this.listFlags(workspaceId);
      const staleFlags = flags.filter((flag) => {
        if (flag.expiresAt && flag.expiresAt * 1000 < now) return true;
        if (flag.createdAt && now - flag.createdAt > thresholdMs) return true;
        return false;
      });

      if (staleFlags.length === 0) return 0;

      logger.info(
        `[FeatureFlags] Pruning ${staleFlags.length} stale flags (WS: ${workspaceId || 'GLOBAL'})`
      );

      const prunedNames: string[] = [];
      for (const flag of staleFlags) {
        try {
          await ConfigManager.deleteConfig(`${this.FLAG_KEY_PREFIX}${flag.name}`, { workspaceId });
          prunedNames.push(flag.name);
          this.cache.delete(this.getCacheKey(flag.name, workspaceId));
        } catch (e) {
          logger.warn(`Failed to delete stale flag ${flag.name}:`, e);
        }
      }

      if (prunedNames.length > 0) {
        await ConfigManager.atomicRemoveFromList('feature_flags_list', prunedNames, {
          workspaceId,
        });
      }

      return prunedNames.length;
    } catch (e) {
      logger.error(
        `[FeatureFlags] Failed to prune stale flags (WS: ${workspaceId || 'GLOBAL'}):`,
        e
      );
      return 0;
    }
  }

  private static async getFlag(
    flagName: string,
    workspaceId?: string
  ): Promise<FeatureFlag | null> {
    const cacheKey = this.getCacheKey(flagName, workspaceId);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const flag = await ConfigManager.getRawConfig(`${this.FLAG_KEY_PREFIX}${flagName}`, {
        workspaceId,
      });
      const result = (flag as FeatureFlag) ?? null;
      this.cache.set(cacheKey, { value: result, expiresAt: Date.now() + this.CACHE_TTL_MS });
      return result;
    } catch (e) {
      logger.warn(`Failed to fetch feature flag ${flagName} (WS: ${workspaceId || 'GLOBAL'}):`, e);
      return null;
    }
  }

  private static getCacheKey(name: string, workspaceId?: string): string {
    return workspaceId ? `${workspaceId}:${name}` : name;
  }

  private static hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash);
  }
}
