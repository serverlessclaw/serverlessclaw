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
 * Implements in-memory caching to reduce DDB latency.
 */
export class SafetyConfigManager {
  private static readonly CACHE_TTL_MS = TIME.MS_PER_MINUTE;
  private static readonly CONFIG_KEY = 'safety_policies';
  private static cache: CachedPolicies | null = null;

  /**
   * Retrieves the current safety policies for all tiers.
   * Checks DDB first, then falls back to DEFAULT_POLICIES.
   */
  static async getPolicies(): Promise<Record<SafetyTier, SafetyPolicy>> {
    // 1. Check Cache
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.value;
    }

    try {
      // 2. Fetch from DDB
      const ddbPolicies = await ConfigManager.getRawConfig(this.CONFIG_KEY);

      let policies: Record<SafetyTier, SafetyPolicy>;
      if (ddbPolicies && typeof ddbPolicies === 'object') {
        // Merge DDB policies with defaults to ensure all tiers exist
        policies = { ...DEFAULT_POLICIES };
        for (const [tier, policy] of Object.entries(ddbPolicies)) {
          if (Object.values(SafetyTier).includes(tier as SafetyTier)) {
            policies[tier as SafetyTier] = policy as SafetyPolicy;
          } else {
            logger.warn(`[SafetyConfigManager] Ignoring unknown safety tier from DDB: ${tier}`);
          }
        }

        // Sh6 Fix: Warn on missing tiers defined in enum
        for (const tier of Object.values(SafetyTier)) {
          if (!(tier in (ddbPolicies as object))) {
            logger.warn(
              `[SafetyConfigManager] Tier '${tier}' missing from DDB, using code defaults.`
            );
          }
        }

        logger.info('Safety policies loaded from DynamoDB');
      } else {
        policies = DEFAULT_POLICIES;
        logger.info('Using default safety policies (no DDB override found)');
      }

      // 3. Update Cache
      this.cache = {
        value: policies,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      };

      return policies;
    } catch (e) {
      logger.warn('Failed to fetch safety policies from DDB, falling back to defaults:', e);
      return DEFAULT_POLICIES;
    }
  }

  /**
   * Retrieves a policy for a specific safety tier.
   */
  static async getPolicy(tier: SafetyTier): Promise<SafetyPolicy> {
    const policies = await this.getPolicies();
    return policies[tier] || DEFAULT_POLICIES[tier];
  }

  /**
   * Saves or updates safety policies in the ConfigTable.
   * Enforces Principle 13 (Atomic State Integrity) by using atomic field updates.
   */
  static async savePolicies(policies: Record<string, Partial<SafetyPolicy>>): Promise<void> {
    for (const [tier, policy] of Object.entries(policies)) {
      if (Object.values(SafetyTier).includes(tier as SafetyTier)) {
        await ConfigManager.atomicUpdateMapEntity(this.CONFIG_KEY, tier, policy);
        logger.info(`[SafetyConfigManager] Atomically updated safety policy for tier: ${tier}`);
      }
    }

    // Invalidate cache immediately to ensure next read sees the changes
    this.cache = null;
    logger.info('[SafetyConfigManager] Cache invalidated after atomic policy updates.');
  }

  /**
   * Clears the in-memory cache of safety policies.
   */
  static clearCache(): void {
    this.cache = null;
  }
}
