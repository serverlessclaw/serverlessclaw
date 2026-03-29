import { Resource } from 'sst';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SSTResource } from '../../lib/types/system';
import { knowledgeSchema } from './schema';
import { formatErrorMessage } from '../../lib/utils/error';

// Cast Resource to SSTResource type to access infrastructure resources
const typedResource = Resource as unknown as SSTResource;

/**
 * Retrieves the current runtime configuration, including active LLM provider and model.
 */
export const checkConfig = {
  ...knowledgeSchema.checkConfig,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const {
      agentName,
      initiatorId,
      traceId,
      activeModel: injectedModel,
      activeProvider: injectedProvider,
    } = args as {
      agentName: string;
      initiatorId: string;
      traceId: string;
      activeModel?: string;
      activeProvider?: string;
    };

    const { ConfigManager } = await import('../../lib/registry/config');

    // These represent the global DDB-based overrides (from switchModel)
    const ddbProvider = await ConfigManager.getRawConfig('active_provider');
    const ddbModel = await ConfigManager.getRawConfig('active_model');

    return `
[RUNTIME_CONFIG]
AGENT_NAME: ${agentName}
INITIATOR: ${initiatorId}
TRACE_ID: ${traceId}
ACTIVE_PROVIDER: ${injectedProvider ?? ddbProvider ?? 'openai (default)'}
ACTIVE_MODEL: ${injectedModel ?? ddbModel ?? 'gpt-5.4-mini (default)'}
STAGING_BUCKET: ${typedResource.StagingBucket?.name ?? 'N/A'}
    `.trim();
  },
};

/**
 * Lists all available runtime configuration keys and their current values.
 */
export const listSystemConfigs = {
  ...knowledgeSchema.listSystemConfigs,
  execute: async (): Promise<string> => {
    try {
      const { defaultDocClient } = await import('../../lib/registry/config');
      const { ConfigTable } = Resource as unknown as Record<string, { name: string }>;

      if (!ConfigTable?.name) {
        return 'ConfigTable not linked. Unable to list configurations.';
      }

      const { Items } = await defaultDocClient.send(
        new ScanCommand({
          TableName: ConfigTable.name,
        })
      );

      if (!Items || Items.length === 0) {
        return 'No system configurations found.';
      }

      const configMap = Items.map(
        (item: Record<string, unknown>) => `- ${item.key}: ${JSON.stringify(item.value)}`
      ).join('\n');

      return `[SYSTEM_CONFIGURATIONS]\n${configMap}`;
    } catch (e: unknown) {
      return `Failed to list configurations: ${formatErrorMessage(e)}`;
    }
  },
};

/**
 * Updates a system configuration key with a new value.
 */
export const setSystemConfig = {
  ...knowledgeSchema.setSystemConfig,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { key, value } = args as { key: string; value: string };
    try {
      const { ConfigManager } = await import('../../lib/registry/config');
      await ConfigManager.saveRawConfig(key, value);
      return `Successfully updated system configuration: ${key}`;
    } catch (e: unknown) {
      return `Failed to update configuration: ${formatErrorMessage(e)}`;
    }
  },
};
