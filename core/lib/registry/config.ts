import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from '../types/index';
import { logger } from '../logger';

// Default client for backward compatibility - can be overridden for testing
const defaultClient = new DynamoDBClient({});
export const defaultDocClient = DynamoDBDocumentClient.from(defaultClient);

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

const typedResource = Resource as unknown as SSTResource;

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
    if (!typedResource.ConfigTable?.name) {
      logger.warn(`ConfigTable not linked. Skipping fetch for ${key}`);
      return undefined;
    }

    try {
      const { Item } = await getDocClient().send(
        new GetCommand({
          TableName: typedResource.ConfigTable.name,
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
   * Saves a raw configuration value to the ConfigTable.
   *
   * @param key - The unique configuration key.
   * @param value - The value to store.
   */
  public static async saveRawConfig(key: string, value: unknown): Promise<void> {
    if (!typedResource.ConfigTable?.name) {
      logger.warn(`ConfigTable not linked. Skipping save for ${key}`);
      return;
    }

    try {
      await getDocClient().send(
        new PutCommand({
          TableName: typedResource.ConfigTable.name,
          Item: { key, value },
        })
      );
    } catch (e) {
      logger.error(`Failed to save ${key} to DDB:`, e);
      throw e;
    }
  }

  /**
   * Resolves the table name for the configured ConfigTable.
   *
   * @returns A promise resolving to the table name or undefined.
   */
  public static async resolveTableName(): Promise<string | undefined> {
    return typedResource.ConfigTable?.name;
  }
}
