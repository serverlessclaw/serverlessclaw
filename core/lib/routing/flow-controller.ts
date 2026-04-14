import { ConfigManager } from '../registry/config';
import { DistributedState } from '../utils/distributed-state';
import { CONFIG_DEFAULTS } from '../config/config-defaults';

export interface FlowControlResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Centralized flow control for the system backbone.
 * Handles rate limiting, circuit breaking, and configuration caching.
 */
export class FlowController {
  private static configCache = new Map<string, { value: any; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 60000; // 1 minute

  /**
   * Checks if an event can proceed based on rate limits and circuit breaker state.
   */
  static async canProceed(eventType: string): Promise<FlowControlResult> {
    const [circuitThreshold, circuitTimeout, rateCapacity, rateRefill] = await Promise.all([
      this.getCachedConfig(
        CONFIG_DEFAULTS.EVENT_CIRCUIT_THRESHOLD.configKey!,
        CONFIG_DEFAULTS.EVENT_CIRCUIT_THRESHOLD.code
      ),
      this.getCachedConfig(
        CONFIG_DEFAULTS.EVENT_CIRCUIT_TIMEOUT_MS.configKey!,
        CONFIG_DEFAULTS.EVENT_CIRCUIT_TIMEOUT_MS.code
      ),
      this.getCachedConfig(
        CONFIG_DEFAULTS.EVENT_RATE_BUCKET_CAPACITY.configKey!,
        CONFIG_DEFAULTS.EVENT_RATE_BUCKET_CAPACITY.code
      ),
      this.getCachedConfig(
        CONFIG_DEFAULTS.EVENT_RATE_BUCKET_REFILL_MS.configKey!,
        CONFIG_DEFAULTS.EVENT_RATE_BUCKET_REFILL_MS.code
      ),
    ]);

    // 1. Rate Limiting check
    if (!(await DistributedState.consumeToken(eventType, rateCapacity, rateRefill))) {
      return { allowed: false, reason: 'Rate limit exceeded' };
    }

    // 2. Circuit Breaker check
    if (await DistributedState.isCircuitOpen(eventType, circuitThreshold, circuitTimeout)) {
      return { allowed: false, reason: 'Circuit breaker open' };
    }

    return { allowed: true };
  }

  /**
   * Records a failure for an event type.
   */
  static async recordFailure(eventType: string): Promise<void> {
    const circuitThreshold = await this.getCachedConfig(
      CONFIG_DEFAULTS.EVENT_CIRCUIT_THRESHOLD.configKey!,
      CONFIG_DEFAULTS.EVENT_CIRCUIT_THRESHOLD.code
    );
    const circuitTimeout = await this.getCachedConfig(
      CONFIG_DEFAULTS.EVENT_CIRCUIT_TIMEOUT_MS.configKey!,
      CONFIG_DEFAULTS.EVENT_CIRCUIT_TIMEOUT_MS.code
    );

    await DistributedState.recordFailure(eventType, circuitThreshold, circuitTimeout);
  }

  /**
   * Gets a cached configuration value.
   */
  static async getCachedConfig<T>(key: string, defaultValue: T): Promise<T> {
    const cached = this.configCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }
    const value = await ConfigManager.getTypedConfig(key, defaultValue);
    this.configCache.set(key, { value, expiresAt: Date.now() + this.CACHE_TTL_MS });
    return value;
  }
}
