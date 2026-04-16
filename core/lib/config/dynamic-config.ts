import { CONFIG_DEFAULTS, ConfigKey } from './config-defaults';

/**
 * Retrieves a configuration value from DynamoDB if it exists and is hot-swappable,
 * otherwise falls back to the code default. Implements Principle 10 (Lean Evolution).
 *
 * @param key - The internal configuration key.
 * @returns A promise resolving to the effective configuration value.
 */
export async function getDynamicConfigValue<K extends ConfigKey>(
  key: K
): Promise<(typeof CONFIG_DEFAULTS)[K]['code']> {
  const def = CONFIG_DEFAULTS[key];
  if (!def.hotSwappable || !def.configKey) {
    return def.code;
  }

  try {
    const { ConfigManager } = await import('../registry/config');
    return await ConfigManager.getTypedConfig(def.configKey, def.code);
  } catch {
    return def.code;
  }
}
