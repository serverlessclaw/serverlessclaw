import { describe, it, expect } from 'vitest';
import { CONFIG_DEFAULTS, getConfigValue, getHotSwappableKeys, ConfigKey } from './config-defaults';

describe('CONFIG_DEFAULTS', () => {
  describe('structure validation', () => {
    it('should have all entries with required fields', () => {
      for (const [_key, def] of Object.entries(CONFIG_DEFAULTS)) {
        expect(def).toHaveProperty('code');
        expect(def).toHaveProperty('hotSwappable');
        expect(def).toHaveProperty('description');
        expect(typeof def.description).toBe('string');
        expect(def.description.length).toBeGreaterThan(0);
        if (def.hotSwappable) {
          expect(def.configKey).toBeTruthy();
          expect(typeof def.configKey).toBe('string');
        }
      }
    });

    it('should have numeric code values for numeric configs', () => {
      const numericKeys: ConfigKey[] = [
        'RECURSION_LIMIT',
        'DEPLOY_LIMIT',
        'MAX_DEPLOY_LIMIT',
        'CIRCUIT_BREAKER_THRESHOLD',
        'CIRCUIT_BREAKER_WINDOW_MS',
        'CIRCUIT_BREAKER_COOLDOWN_MS',
        'MAX_TOOL_ITERATIONS',
        'TRACE_RETENTION_DAYS',
        'MESSAGE_RETENTION_DAYS',
        'STALE_GAP_DAYS',
        'STRATEGIC_REVIEW_FREQUENCY_HOURS',
        'MIN_GAPS_FOR_REVIEW',
        'CLARIFICATION_TIMEOUT_MS',
        'CLARIFICATION_MAX_RETRIES',
        'PARALLEL_BARRIER_TIMEOUT_MS',
        'PARALLEL_PARTIAL_SUCCESS_THRESHOLD',
        'CONTEXT_SAFETY_MARGIN',
        'CONTEXT_SUMMARY_TRIGGER_RATIO',
        'CONTEXT_SUMMARY_RATIO',
        'CONTEXT_ACTIVE_WINDOW_RATIO',
        'ALERT_ERROR_RATE_THRESHOLD',
        'ALERT_DLQ_THRESHOLD',
        'ALERT_TOKEN_ANOMALY_MULTIPLIER',
      ];
      for (const key of numericKeys) {
        expect(typeof CONFIG_DEFAULTS[key].code).toBe('number');
      }
    });

    it('should have boolean code values for boolean configs', () => {
      const booleanKeys: ConfigKey[] = ['AUTO_PRUNE_ENABLED', 'FEATURE_FLAGS_ENABLED'];
      for (const key of booleanKeys) {
        expect(typeof CONFIG_DEFAULTS[key].code).toBe('boolean');
      }
    });
  });

  describe('value sanity checks', () => {
    it('should have RECURSION_LIMIT > 0', () => {
      expect(CONFIG_DEFAULTS.RECURSION_LIMIT.code).toBeGreaterThan(0);
    });

    it('should have DEPLOY_LIMIT <= MAX_DEPLOY_LIMIT', () => {
      expect(CONFIG_DEFAULTS.DEPLOY_LIMIT.code).toBeLessThanOrEqual(
        CONFIG_DEFAULTS.MAX_DEPLOY_LIMIT.code
      );
    });

    it('should have context ratios that sum to 1.0', () => {
      const summary = CONFIG_DEFAULTS.CONTEXT_SUMMARY_RATIO.code;
      const active = CONFIG_DEFAULTS.CONTEXT_ACTIVE_WINDOW_RATIO.code;
      expect(summary + active).toBeCloseTo(1.0, 2);
    });

    it('should have CONTEXT_SAFETY_MARGIN between 0 and 1', () => {
      const margin = CONFIG_DEFAULTS.CONTEXT_SAFETY_MARGIN.code;
      expect(margin).toBeGreaterThan(0);
      expect(margin).toBeLessThan(1);
    });

    it('should have PARALLEL_PARTIAL_SUCCESS_THRESHOLD between 0 and 1', () => {
      const threshold = CONFIG_DEFAULTS.PARALLEL_PARTIAL_SUCCESS_THRESHOLD.code;
      expect(threshold).toBeGreaterThan(0);
      expect(threshold).toBeLessThanOrEqual(1);
    });
  });
});

describe('getConfigValue', () => {
  it('should return the code default when no runtime value is provided', () => {
    expect(getConfigValue('RECURSION_LIMIT')).toBe(15);
    expect(getConfigValue('DEPLOY_LIMIT')).toBe(5);
    expect(getConfigValue('FEATURE_FLAGS_ENABLED')).toBe(true);
  });

  it('should return the runtime value when provided', () => {
    expect(getConfigValue('RECURSION_LIMIT', 25)).toBe(25);
    expect(getConfigValue('DEPLOY_LIMIT', 10)).toBe(10);
    expect(getConfigValue('FEATURE_FLAGS_ENABLED', false)).toBe(false);
  });

  it('should return code default when runtime value is undefined', () => {
    expect(getConfigValue('MAX_TOOL_ITERATIONS', undefined)).toBe(50);
    expect(getConfigValue('STALE_GAP_DAYS')).toBe(30);
    expect(getConfigValue('MAX_RECOVERY_ATTEMPTS')).toBe(4);
    expect(getConfigValue('STRATEGIC_REVIEW_FREQUENCY_HOURS')).toBe(48);
    expect(getConfigValue('MIN_GAPS_FOR_REVIEW')).toBe(20);
  });
});

describe('getHotSwappableKeys', () => {
  it('should return only hot-swappable keys with configKey', () => {
    const keys = getHotSwappableKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const { key, configKey } of keys) {
      expect(CONFIG_DEFAULTS[key].hotSwappable).toBe(true);
      expect(configKey).toBeTruthy();
    }
  });

  it('should not include non-hot-swappable keys', () => {
    const keys = getHotSwappableKeys();
    const keyNames = keys.map((k) => k.key);
    expect(keyNames).not.toContain('MAX_DEPLOY_LIMIT');
    expect(keyNames).not.toContain('MAX_RECOVERY_ATTEMPTS');
    expect(keyNames).not.toContain('TIMEOUT_BUFFER_MS');
  });

  it('should include known hot-swappable keys', () => {
    const keys = getHotSwappableKeys();
    const keyNames = keys.map((k) => k.key);
    expect(keyNames).toContain('RECURSION_LIMIT');
    expect(keyNames).toContain('DEPLOY_LIMIT');
    expect(keyNames).toContain('CIRCUIT_BREAKER_THRESHOLD');
    expect(keyNames).toContain('FEATURE_FLAGS_ENABLED');
    expect(keyNames).toContain('STALE_GAP_DAYS');
    expect(keyNames).toContain('STRATEGIC_REVIEW_FREQUENCY_HOURS');
    expect(keyNames).toContain('MIN_GAPS_FOR_REVIEW');
  });
});
