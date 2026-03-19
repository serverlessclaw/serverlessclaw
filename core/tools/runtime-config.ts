import { Resource } from 'sst';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { toolDefinitions } from './definitions/index';

/**
 * Retrieves the current runtime configuration, including active LLM provider and model.
 */
export const CHECK_CONFIG = {
  ...toolDefinitions.checkConfig,
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

    const { ConfigManager } = await import('../lib/registry/config');

    // These represent the global DDB-based overrides (from switchModel)
    const ddbProvider = await ConfigManager.getRawConfig('active_provider');
    const ddbModel = await ConfigManager.getRawConfig('active_model');

    return `
[RUNTIME_CONFIG]
AGENT_NAME: ${agentName}
INITIATOR: ${initiatorId}
TRACE_ID: ${traceId}
ACTIVE_PROVIDER: ${injectedProvider ?? ddbProvider ?? 'openai (default)'}
ACTIVE_MODEL: ${injectedModel ?? ddbModel ?? 'gpt-5-mini (default)'}
STAGING_BUCKET: ${Resource.StagingBucket.name}
    `.trim();
  },
};

/**
 * Lists all available runtime configuration keys and their current values.
 */
export const LIST_SYSTEM_CONFIGS = {
  ...toolDefinitions.listSystemConfigs,
  execute: async (): Promise<string> => {
    try {
      const { defaultDocClient } = await import('../lib/registry/config');
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
        (item: Record<string, any>) => `- ${item.key}: ${JSON.stringify(item.value)}`
      ).join('\n');

      return `[SYSTEM_CONFIGURATIONS]\n${configMap}`;
    } catch (e: unknown) {
      const { formatErrorMessage } = await import('../lib/utils/error');
      return `Failed to list configurations: ${formatErrorMessage(e)}`;
    }
  },
};
