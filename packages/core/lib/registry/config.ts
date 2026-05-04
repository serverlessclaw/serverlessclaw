import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { ConfigManagerMap } from './config/map';
import { getDocClient } from './config/client';

export { setDocClient, getDocClient, defaultDocClient } from './config/client';

/**
 * Handles raw configuration storage and retrieval from DynamoDB.
 * Implements a local cache to satisfy Low Latency goals (Principle 5).
 *
 * This class is split into multiple modules in the ./config directory to maintain
 * AI grounding and stay within context limits.
 */
export class ConfigManager extends ConfigManagerMap {
  /**
   * Fetches a configuration value with agent-specific override precedence.
   */
  public static async getAgentOverrideConfig<T>(
    agentId: string,
    key: string,
    fallback: T,
    options?: { workspaceId?: string }
  ): Promise<T> {
    const agentKey = `agent_config_${agentId}_${key}`;
    const agentValue = await this.getRawConfig(agentKey, options);
    if (agentValue !== undefined) return agentValue as T;
    return this.getTypedConfig<T>(key, fallback, options);
  }

  /**
   * Resolves the table name for the configured ConfigTable.
   */
  public static async resolveTableName(): Promise<string | undefined> {
    return this._getTableName();
  }

  /**
   * Atomically increments a numeric configuration value.
   */
  public static async incrementConfig(
    key: string,
    increment: number = 1,
    options?: { workspaceId?: string; orgId?: string }
  ): Promise<number> {
    const tableName = this._getTableName();
    if (!tableName) return 0;

    const { emitMetrics, METRICS } = await import('../metrics/metrics');
    emitMetrics([METRICS.configAccessed(key, 'increment', options)]).catch(() => {});

    const effectiveKey = this.getEffectiveKey(key, options);
    this.configCache.delete(effectiveKey);

    try {
      const result = await getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: 'ADD #val :inc',
          ExpressionAttributeNames: { '#val': 'value' },
          ExpressionAttributeValues: { ':inc': increment },
          ReturnValues: 'ALL_NEW',
        })
      );
      return (result.Attributes?.value as number) ?? 0;
    } catch (e) {
      logger.warn(`Failed to increment ${effectiveKey} in DDB:`, e);
      return 0;
    }
  }
}
