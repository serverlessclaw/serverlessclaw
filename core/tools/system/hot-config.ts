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
