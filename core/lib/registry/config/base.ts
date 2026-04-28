import { GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../logger';
import { getConfigTableName } from '../../utils/ddb-client';
import { getDocClient } from './client';

/**
 * Base configuration management with caching and CRUD operations.
 */
export class ConfigManagerBase {
  protected static configCache = new Map<string, { value: unknown; expiresAt: number }>();
  protected static readonly CACHE_TTL_MS = 60000; // 1 minute (60s)

  /**
   * Clears the configuration cache. Primarily for testing.
   */
  public static clearCache(): void {
    this.configCache.clear();
  }

  /**
   * Internal helper to safely get the ConfigTable name.
   */
  protected static _getTableName(): string | undefined {
    return getConfigTableName();
  }

  /**
   * Resolves the effective key based on workspace or organization scoping.
   */
  protected static getEffectiveKey(
    key: string,
    options?: { workspaceId?: string; orgId?: string }
  ): string {
    if (options?.workspaceId) {
      return `WS#${options.workspaceId}#${key}`;
    }
    if (options?.orgId) {
      return `ORG#${options.orgId}#${key}`;
    }
    return key;
  }

  /**
   * Fetches a raw value from the ConfigTable by key.
   */
  public static async getRawConfig(
    key: string,
    options?: { workspaceId?: string; orgId?: string }
  ): Promise<unknown> {
    const tableName = this._getTableName();
    if (!tableName) {
      logger.warn(`ConfigTable not linked. Skipping fetch for ${key}`);
      return undefined;
    }

    const effectiveKey = this.getEffectiveKey(key, options);

    try {
      const { Item } = await getDocClient().send(
        new GetCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
        })
      );
      return Item?.value;
    } catch (e) {
      logger.warn(`Failed to fetch ${effectiveKey} from DDB:`, e);
      return undefined;
    }
  }

  /**
   * Fetches a configuration value with a type-safe fallback.
   * Implements internal caching to minimize DynamoDB overhead.
   */
  public static async getTypedConfig<T>(
    key: string,
    defaultValue: T,
    options?: { workspaceId?: string; orgId?: string }
  ): Promise<T> {
    const cacheKey = this.getEffectiveKey(key, options);
    const cached = this.configCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    const value = await this.getRawConfig(key, options);
    const result = (value as T) ?? defaultValue;

    this.configCache.set(cacheKey, { value: result, expiresAt: Date.now() + this.CACHE_TTL_MS });
    return result;
  }

  /**
   * Saves a raw configuration value to the ConfigTable.
   */
  public static async saveRawConfig(
    key: string,
    value: unknown,
    options?: {
      author?: string;
      description?: string;
      skipVersioning?: boolean;
      workspaceId?: string;
      orgId?: string;
    }
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) {
      logger.warn(`ConfigTable not linked. Skipping save for ${key}`);
      return;
    }

    const cacheKey = this.getEffectiveKey(key, options);
    this.configCache.delete(cacheKey);

    if (!options?.skipVersioning) {
      try {
        const oldValue = await this.getRawConfig(key, {
          workspaceId: options?.workspaceId,
          orgId: options?.orgId,
        });
        if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
          const { ConfigVersioning } = await import('../../config/config-versioning');
          await ConfigVersioning.snapshot(
            key,
            oldValue,
            value,
            options?.author ?? 'system',
            options?.description,
            { workspaceId: options?.workspaceId, orgId: options?.orgId }
          );
        }
      } catch (e) {
        logger.warn(`Failed to snapshot config version for ${key}:`, e);
      }
    }

    try {
      await getDocClient().send(
        new PutCommand({
          TableName: tableName,
          Item: { key: cacheKey, value },
        })
      );
    } catch (e) {
      logger.error(`Failed to save ${cacheKey} to DDB:`, e);
      throw e;
    }
  }

  /**
   * Deletes a configuration value from the ConfigTable.
   */
  public static async deleteConfig(
    key: string,
    options?: { workspaceId?: string; orgId?: string }
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) {
      logger.warn(`ConfigTable not linked. Skipping delete for ${key}`);
      return;
    }

    const effectiveKey = this.getEffectiveKey(key, options);
    this.configCache.delete(effectiveKey);

    try {
      await getDocClient().send(
        new DeleteCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
        })
      );
    } catch (e) {
      logger.error(`Failed to delete ${effectiveKey} from DDB:`, e);
      throw e;
    }
  }
}
