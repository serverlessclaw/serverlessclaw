import { ConfigManager } from './registry/config';
import { CONFIG_DEFAULTS } from './config/config-defaults';
import { logger } from './logger';
import { TIME } from './constants';

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  rolloutPercent: number;
  targetAgents?: string[];
  description: string;
  expiresAt?: number;
  createdAt?: number;
}

interface CachedFlag {
  value: FeatureFlag | null;
  expiresAt: number;
}

export class FeatureFlags {
  private static readonly CACHE_TTL_MS = TIME.MS_PER_MINUTE;
  private static readonly FLAG_KEY_PREFIX = 'feature_flag_';
  private static cache = new Map<string, CachedFlag>();

  static async isEnabled(flagName: string, agentId?: string): Promise<boolean> {
    try {
      const flagsEnabled = await ConfigManager.getTypedConfig(
        CONFIG_DEFAULTS.FEATURE_FLAGS_ENABLED.configKey!,
        CONFIG_DEFAULTS.FEATURE_FLAGS_ENABLED.code
      );
      if (!flagsEnabled) return false;
    } catch {
      if (!CONFIG_DEFAULTS.FEATURE_FLAGS_ENABLED.code) return false;
    }

    const flag = await this.getFlag(flagName);
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

  static async setFlag(flag: FeatureFlag): Promise<void> {
    await ConfigManager.saveRawConfig(`${this.FLAG_KEY_PREFIX}${flag.name}`, flag, {
      author: 'system:feature-flags',
      skipVersioning: true,
    });

    try {
      await ConfigManager.atomicAppendToList('feature_flags_list', [flag.name], {
        preventDuplicates: true,
      });
    } catch (e) {
      logger.warn(`Failed to atomically update feature_flags_list:`, e);
    }

    this.cache.delete(flag.name);
  }

  static async listFlags(): Promise<FeatureFlag[]> {
    try {
      const rawFlags = await ConfigManager.getTypedConfig('feature_flags_list', [] as string[]);
      const flags = await Promise.all(rawFlags.map((name: string) => this.getFlag(name)));
      return flags.filter((f): f is FeatureFlag => f !== null);
    } catch (error) {
      logger.warn('Failed to list feature flags:', error);
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
  static async pruneStaleFlags(daysThreshold: number = 30): Promise<number> {
    const thresholdMs = daysThreshold * TIME.MS_PER_DAY;
    const now = Date.now();

    try {
      const flags = await this.listFlags();
      const staleFlags = flags.filter((flag) => {
        if (flag.expiresAt && flag.expiresAt * 1000 < now) return true;
        if (flag.createdAt && now - flag.createdAt > thresholdMs) return true;
        return false;
      });

      if (staleFlags.length === 0) return 0;

      logger.info(`[FeatureFlags] Pruning ${staleFlags.length} stale flags`);

      const prunedNames: string[] = [];
      for (const flag of staleFlags) {
        try {
          await ConfigManager.deleteConfig(`${this.FLAG_KEY_PREFIX}${flag.name}`);
          prunedNames.push(flag.name);
          this.cache.delete(flag.name);
        } catch (e) {
          logger.warn(`Failed to delete stale flag ${flag.name}:`, e);
        }
      }

      if (prunedNames.length > 0) {
        await ConfigManager.atomicRemoveFromList('feature_flags_list', prunedNames);
      }

      return prunedNames.length;
    } catch (e) {
      logger.error('[FeatureFlags] Failed to prune stale flags:', e);
      return 0;
    }
  }

  private static async getFlag(flagName: string): Promise<FeatureFlag | null> {
    const cached = this.cache.get(flagName);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const flag = await ConfigManager.getRawConfig(`${this.FLAG_KEY_PREFIX}${flagName}`);
      const result = (flag as FeatureFlag) ?? null;
      this.cache.set(flagName, { value: result, expiresAt: Date.now() + this.CACHE_TTL_MS });
      return result;
    } catch (e) {
      logger.warn(`Failed to fetch feature flag ${flagName}:`, e);
      return null;
    }
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
