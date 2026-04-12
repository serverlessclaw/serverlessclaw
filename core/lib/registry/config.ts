import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { logger } from '../logger';

// Default client for backward compatibility - can be overridden for testing
const defaultClient = new DynamoDBClient({});
export const defaultDocClient = DynamoDBDocumentClient.from(defaultClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: true,
  },
});

// Allow tests to inject a custom docClient
let injectedDocClient: DynamoDBDocumentClient | undefined;

/**
 * Sets a custom docClient for testing purposes.
 * @param docClient - The DynamoDB Document Client to use
 */
export function setDocClient(docClient: DynamoDBDocumentClient): void {
  injectedDocClient = docClient;
}

function getDocClient(): DynamoDBDocumentClient {
  return injectedDocClient ?? defaultDocClient;
}

/**
 * Handles raw configuration storage and retrieval from DynamoDB.
 * @since 2026-03-19
 */
export class ConfigManager {
  /**
   * Fetches a raw value from the ConfigTable by key.
   *
   * @param key - The unique configuration key.
   * @returns A promise resolving to the configuration value or undefined.
   */
  public static async getRawConfig(key: string): Promise<unknown> {
    const resource = Resource as { ConfigTable?: { name: string } };
    if (!('ConfigTable' in resource)) {
      logger.warn(`ConfigTable not linked. Skipping fetch for ${key}`);
      return undefined;
    }

    try {
      const { Item } = await getDocClient().send(
        new GetCommand({
          TableName: resource.ConfigTable?.name,
          Key: { key },
        })
      );
      return Item?.value;
    } catch (e) {
      logger.warn(`Failed to fetch ${key} from DDB:`, e);
      return undefined;
    }
  }

  /**
   * Fetches a configuration value with a type-safe fallback.
   *
   * @param key - The unique configuration key.
   * @param defaultValue - The fallback value if the key is not found.
   * @returns A promise resolving to the typed configuration value.
   */
  public static async getTypedConfig<T>(key: string, defaultValue: T): Promise<T> {
    const value = await this.getRawConfig(key);
    return (value as T) ?? defaultValue;
  }

  /**
   * Fetches a configuration value with agent-specific override precedence.
   * Checks agent_config_<agentId>_<key> first, then falls back to global key.
   *
   * @param agentId - The agent identifier.
   * @param key - The configuration key.
   * @param fallback - The value to use if neither override nor global exists.
   * @returns A promise resolving to the effective configuration value.
   */
  public static async getAgentOverrideConfig<T>(
    agentId: string,
    key: string,
    fallback: T
  ): Promise<T> {
    const agentKey = `agent_config_${agentId}_${key}`;
    const agentValue = await this.getRawConfig(agentKey);
    if (agentValue !== undefined) return agentValue as T;
    return this.getTypedConfig<T>(key, fallback);
  }

  /**
   * Saves a raw configuration value to the ConfigTable.
   * Optionally snapshots the old value for versioning.
   *
   * @param key - The unique configuration key.
   * @param value - The value to store.
   * @param options - Optional versioning and audit options.
   */
  public static async saveRawConfig(
    key: string,
    value: unknown,
    options?: {
      author?: string;
      description?: string;
      skipVersioning?: boolean;
    }
  ): Promise<void> {
    const resource = Resource as { ConfigTable?: { name: string } };
    if (!('ConfigTable' in resource)) {
      logger.warn(`ConfigTable not linked. Skipping save for ${key}`);
      return;
    }

    if (!options?.skipVersioning) {
      try {
        const oldValue = await this.getRawConfig(key);
        if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
          const { ConfigVersioning } = await import('../config/config-versioning');
          await ConfigVersioning.snapshot(
            key,
            oldValue,
            value,
            options?.author ?? 'system',
            options?.description
          );
        }
      } catch (e) {
        logger.warn(`Failed to snapshot config version for ${key}:`, e);
      }
    }

    try {
      await getDocClient().send(
        new PutCommand({
          TableName: resource.ConfigTable?.name,
          Item: { key, value },
        })
      );
    } catch (e) {
      logger.error(`Failed to save ${key} to DDB:`, e);
      throw e;
    }
  }

  /**
   * Atomically appends a value to a list configuration.
   * Uses DynamoDB list_append to avoid lost update bugs.
   *
   * @param key - The unique configuration key.
   * @param item - The item to append.
   * @param options - Optional capping for the list (e.g., last 200 items).
   * @returns A promise that resolves when the append is complete.
   */
  public static async appendToList(
    key: string,
    item: unknown,
    options?: { limit?: number }
  ): Promise<void> {
    const resource = Resource as { ConfigTable?: { name: string } };
    if (!('ConfigTable' in resource)) {
      logger.warn(`ConfigTable not linked. Skipping append for ${key}`);
      return;
    }

    try {
      const { limit } = options || {};

      // Phase 1: Ensure value is initialized as a list if it doesn't exist
      await getDocClient().send(
        new UpdateCommand({
          TableName: resource.ConfigTable!.name,
          Key: { key },
          UpdateExpression: 'SET #val = if_not_exists(#val, :empty_list)',
          ExpressionAttributeNames: { '#val': 'value' },
          ExpressionAttributeValues: { ':empty_list': [] },
        })
      );

      // Phase 2: Append the item
      const result = await getDocClient().send(
        new UpdateCommand({
          TableName: resource.ConfigTable!.name,
          Key: { key },
          UpdateExpression: 'SET #val = list_append(#val, :items)',
          ExpressionAttributeNames: { '#val': 'value' },
          ExpressionAttributeValues: { ':items': [item] },
          ReturnValues: 'ALL_NEW',
        })
      );

      // Phase 3: Optional capping (best effort, not perfectly atomic with the append)
      // Since list_append + truncation can't be one atomic op in DDB without knowing length,
      // we do it if ReturnValues shows it's too long.
      const currentList = result.Attributes?.value as unknown[];
      if (limit && currentList && currentList.length > limit) {
        const excess = currentList.length - limit;
        // Truncate from the beginning
        await getDocClient()
          .send(
            new UpdateCommand({
              TableName: resource.ConfigTable!.name,
              Key: { key },
              UpdateExpression: `REMOVE ${Array.from({ length: excess }, (_, i) => `#val[${i}]`).join(', ')}`,
              ExpressionAttributeNames: { '#val': 'value' },
            })
          )
          .catch((e) => logger.debug(`List capping failed for ${key}:`, e));
      }
    } catch (e) {
      logger.error(`Failed to append to list ${key} in DDB:`, e);
      throw e;
    }
  }

  /**
   * Resolves the table name for the configured ConfigTable.
   *
   * @returns A promise resolving to the table name or undefined.
   */
  public static async resolveTableName(): Promise<string | undefined> {
    const resource = Resource as { ConfigTable?: { name: string } };
    return 'ConfigTable' in resource ? resource.ConfigTable!.name : undefined;
  }

  /**
   * Atomically increments a numeric configuration value.
   * Uses DynamoDB UpdateCommand with ADD operation to avoid lost update bugs.
   *
   * @param key - The unique configuration key.
   * @param increment - The amount to increment (default 1).
   * @returns A promise resolving to the new value after increment.
   */
  public static async incrementConfig(key: string, increment: number = 1): Promise<number> {
    const resource = Resource as { ConfigTable?: { name: string } };
    if (!('ConfigTable' in resource)) {
      logger.warn(`ConfigTable not linked. Skipping increment for ${key}`);
      return 0;
    }

    try {
      const result = await getDocClient().send(
        new UpdateCommand({
          TableName: resource.ConfigTable?.name,
          Key: { key },
          UpdateExpression: 'ADD #val :inc',
          ExpressionAttributeNames: { '#val': 'value' },
          ExpressionAttributeValues: { ':inc': increment },
          ReturnValues: 'ALL_NEW',
        })
      );
      return (result.Attributes?.value as number) ?? 0;
    } catch (e) {
      logger.warn(`Failed to increment ${key} in DDB:`, e);
      return 0;
    }
  }
}
