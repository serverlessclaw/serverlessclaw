import { SafetyTier, SafetyPolicy } from '../types/agent';
import { ConfigManager } from '../registry/config';
import { DEFAULT_POLICIES } from './safety-config';
import { logger } from '../logger';
import { TIME } from '../constants';

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
   */
  static async savePolicies(policies: Record<string, Partial<SafetyPolicy>>): Promise<void> {
    const current = await this.getPolicies();
    const updated = { ...current };

    for (const [tier, policy] of Object.entries(policies)) {
      if (Object.values(SafetyTier).includes(tier as SafetyTier)) {
        updated[tier as SafetyTier] = {
          ...updated[tier as SafetyTier],
          ...policy,
        } as SafetyPolicy;
      }
    }

    await ConfigManager.saveRawConfig(this.CONFIG_KEY, updated, {
      author: 'system:safety-manager',
      description: 'Updated safety policies via SafetyConfigManager',
    });

    // Invalidate cache
    this.cache = null;
  }

  /**
   * Clears the in-memory cache of safety policies.
   */
  static clearCache(): void {
    this.cache = null;
  }
}
