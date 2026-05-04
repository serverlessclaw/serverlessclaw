import { SafetyTier, SafetyPolicy } from '../types/agent';
import { ConfigManager } from '../registry/config';
import { logger } from '../logger';
import { TIME } from '../constants';
import { DEFAULT_POLICIES } from './policy-defaults';

interface CachedPolicies {
  value: Record<SafetyTier, SafetyPolicy>;
  expiresAt: number;
}

/**
 * Manages safety policies, fetching them from DynamoDB with falling back to code defaults.
 * Implements in-memory caching to reduce DDB latency, scoped by workspace.
 */
export class SafetyConfigManager {
  private static readonly CACHE_TTL_MS = TIME.MS_PER_MINUTE;
  private static readonly CONFIG_KEY = 'safety_policies';
  private static caches: Map<string, CachedPolicies> = new Map();

  /**
   * Retrieves the current safety policies for all tiers.
   * Checks DDB first, then falls back to DEFAULT_POLICIES.
   */
  static async getPolicies(options?: {
    workspaceId?: string;
    orgId?: string;
  }): Promise<Record<SafetyTier, SafetyPolicy>> {
    const { workspaceId, orgId } = options || {};
    const cacheKey = orgId ? `ORG#${orgId}` : workspaceId || 'global';
    // 1. Check Cache
    const cache = this.caches.get(cacheKey);
    if (cache && cache.expiresAt > Date.now()) {
      return cache.value;
    }

    try {
      // 2. Fetch from DDB
      const ddbPolicies = await ConfigManager.getRawConfig(this.CONFIG_KEY, { workspaceId, orgId });

      let policies: Record<SafetyTier, SafetyPolicy>;
      if (ddbPolicies && typeof ddbPolicies === 'object') {
        // Merge DDB policies with defaults to ensure all tiers exist
        policies = { ...DEFAULT_POLICIES };
        for (const [tier, policy] of Object.entries(ddbPolicies)) {
          if (Object.values(SafetyTier).includes(tier as SafetyTier)) {
            policies[tier as SafetyTier] = policy as SafetyPolicy;
          } else {
            logger.warn(
              `[SafetyConfigManager] Ignoring unknown safety tier from DDB: ${tier} (WS: ${cacheKey})`
            );
          }
        }

        // Sh6 Fix: Warn on missing tiers defined in enum
        for (const tier of Object.values(SafetyTier)) {
          if (!(tier in (ddbPolicies as object))) {
            logger.warn(
              `[SafetyConfigManager] Tier '${tier}' missing from DDB for ${cacheKey}, using code defaults.`
            );
          }
        }

        logger.info(`Safety policies loaded from DynamoDB (WS: ${cacheKey})`);
      } else {
        policies = DEFAULT_POLICIES;
        logger.info(`Using default safety policies for ${cacheKey} (no DDB override found)`);
      }

      // 3. Update Cache
      this.caches.set(cacheKey, {
        value: policies,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });

      return policies;
    } catch (e) {
      logger.error(
        `[SafetyConfigManager] Failed to fetch safety policies from DDB for ${cacheKey}. Failing closed to prevent security bypass:`,
        e
      );
      throw new Error(
        `[SafetyConfigManager] Database outage - cannot safely evaluate policies for ${cacheKey}`
      );
    }
  }

  /**
   * Retrieves a policy for a specific safety tier.
   */
  static async getPolicy(
    tier: SafetyTier,
    options?: { workspaceId?: string; orgId?: string }
  ): Promise<SafetyPolicy> {
    const policies = await this.getPolicies(options);
    return policies[tier] || DEFAULT_POLICIES[tier];
  }

  /**
   * Saves or updates safety policies in the ConfigTable.
   * Enforces Principle 13 (Atomic State Integrity) by using atomic field updates.
   */
  static async savePolicies(
    policies: Record<string, Partial<SafetyPolicy>>,
    options?: { workspaceId?: string; orgId?: string }
  ): Promise<void> {
    const { workspaceId, orgId } = options || {};
    const cacheKey = orgId ? `ORG#${orgId}` : workspaceId || 'global';
    for (const [tier, policy] of Object.entries(policies)) {
      if (Object.values(SafetyTier).includes(tier as SafetyTier)) {
        await ConfigManager.atomicUpdateMapEntity(this.CONFIG_KEY, tier, policy, {
          workspaceId,
          orgId,
        });
        logger.info(
          `[SafetyConfigManager] Atomically updated safety policy for tier: ${tier} (WS: ${cacheKey})`
        );
      }
    }

    // Invalidate cache immediately to ensure next read sees the changes
    this.caches.delete(cacheKey);
    logger.info(`[SafetyConfigManager] Cache invalidated for ${cacheKey} after atomic updates.`);
  }

  /**
   * Clears the in-memory cache of safety policies.
   */
  static clearCache(options?: { workspaceId?: string; orgId?: string }): void {
    const { workspaceId, orgId } = options || {};
    if (orgId) {
      this.caches.delete(`ORG#${orgId}`);
    } else if (workspaceId) {
      this.caches.delete(workspaceId);
    } else {
      this.caches.clear();
    }
  }
}
