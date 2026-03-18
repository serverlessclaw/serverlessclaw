import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from '../types/index';
import { logger } from '../logger';

const client = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(client);
const typedResource = Resource as unknown as SSTResource;

/**
 * Handles raw configuration storage and retrieval from DynamoDB.
 */
export class ConfigManager {
  /**
   * Fetches a raw value from the ConfigTable by key.
   */
  public static async getRawConfig(key: string): Promise<unknown> {
    if (!typedResource.ConfigTable?.name) {
      logger.warn(`ConfigTable not linked. Skipping fetch for ${key}`);
      return undefined;
    }

    try {
      const { Item } = await docClient.send(
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
   */
  public static async getTypedConfig<T>(key: string, defaultValue: T): Promise<T> {
    const value = await this.getRawConfig(key);
    return (value as T) ?? defaultValue;
  }

  /**
   * Saves a raw configuration value to the ConfigTable.
   */
  public static async saveRawConfig(key: string, value: unknown): Promise<void> {
    if (!typedResource.ConfigTable?.name) {
      logger.warn(`ConfigTable not linked. Skipping save for ${key}`);
      return;
    }

    try {
      await docClient.send(
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
   */
  public static async resolveTableName(): Promise<string | undefined> {
    return typedResource.ConfigTable?.name;
  }
}
