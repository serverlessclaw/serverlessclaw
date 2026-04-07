import { systemSchema as schema } from './schema';
import { CONFIG_KEYS } from '../../lib/constants';
import { formatErrorMessage } from '../../lib/utils/error';

/**
 * Switch the active LLM provider and model at runtime.
 */
export const switchModel = {
  ...schema.switchModel,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { provider, model } = args as { provider: string; model: string };
    try {
      const { AgentRegistry } = await import('../../lib/registry');
      await AgentRegistry.saveRawConfig(CONFIG_KEYS.ACTIVE_PROVIDER, provider);
      await AgentRegistry.saveRawConfig(CONFIG_KEYS.ACTIVE_MODEL, model);
      return `Successfully switched to ${provider} with model ${model}. Hot config applied.`;
    } catch (error) {
      return `Failed to switch model: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Update any global system configuration.
 */
export const setSystemConfig = {
  ...schema.setSystemConfig,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { key, value, description } = args as {
      key: string;
      value: unknown;
      description?: string;
    };
    try {
      const { AgentRegistry } = await import('../../lib/registry');
      await AgentRegistry.saveRawConfig(key, value, { description });
      return `Configuration '${key}' updated successfully.`;
    } catch (error) {
      return `Failed to update configuration: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * Retrieve a global system configuration.
 */
export const getSystemConfig = {
  ...schema.getSystemConfig,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { key } = args as { key: string };
    try {
      const { AgentRegistry } = await import('../../lib/registry');
      const value = await AgentRegistry.getRawConfig(key);
      if (value === undefined) return `Configuration '${key}' not found.`;
      return JSON.stringify({ key, value }, null, 2);
    } catch (error) {
      return `Failed to fetch configuration: ${formatErrorMessage(error)}`;
    }
  },
};

/**
 * List all known system configurations.
 */
export const listSystemConfigs = {
  ...schema.listSystemConfigs,
  execute: async (): Promise<string> => {
    try {
      const { AgentRegistry } = await import('../../lib/registry');
      const keys = Object.values(CONFIG_KEYS);
      const results: Record<string, unknown> = {};

      for (const key of keys) {
        results[key] = await AgentRegistry.getRawConfig(key);
      }

      return JSON.stringify(results, null, 2);
    } catch (error) {
      return `Failed to list configurations: ${formatErrorMessage(error)}`;
    }
  },
};
