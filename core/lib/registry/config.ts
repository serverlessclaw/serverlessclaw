import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger';
import { getConfigTableName } from '../utils/ddb-client';

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

/**
 * Returns the effective docClient (either injected or default).
 */
export function getDocClient(): DynamoDBDocumentClient {
  return injectedDocClient ?? defaultDocClient;
}

/**
 * Handles raw configuration storage and retrieval from DynamoDB.
 * Implements a local cache to satisfy Low Latency goals (Principle 5).
 */
export class ConfigManager {
  private static configCache = new Map<string, { value: unknown; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 60000; // 1 minute (60s)

  private static _warnedMissingConfigTable = false;

  /**
   * Internal helper to safely get the ConfigTable name.
   */
  private static _getTableName(): string | undefined {
    return getConfigTableName();
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

    let effectiveKey = key;
    if (options?.workspaceId) {
      effectiveKey = `WS#${options.workspaceId}#${key}`;
    } else if (options?.orgId) {
      effectiveKey = `ORG#${options.orgId}#${key}`;
    }

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
    let cacheKey = key;
    if (options?.workspaceId) {
      cacheKey = `WS#${options.workspaceId}#${key}`;
    } else if (options?.orgId) {
      cacheKey = `ORG#${options.orgId}#${key}`;
    }
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

    let cacheKey = key;
    if (options?.workspaceId) {
      cacheKey = `WS#${options.workspaceId}#${key}`;
    } else if (options?.orgId) {
      cacheKey = `ORG#${options.orgId}#${key}`;
    }
    this.configCache.delete(cacheKey);

    if (!options?.skipVersioning) {
      try {
        const oldValue = await this.getRawConfig(key, {
          workspaceId: options?.workspaceId,
          orgId: options?.orgId,
        });
        if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
          const { ConfigVersioning } = await import('../config/config-versioning');
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
  public static async deleteConfig(key: string): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) {
      logger.warn(`ConfigTable not linked. Skipping delete for ${key}`);
      return;
    }

    this.configCache.delete(key);

    try {
      await getDocClient().send(
        new DeleteCommand({
          TableName: tableName,
          Key: { key },
        })
      );
    } catch (e) {
      logger.error(`Failed to delete ${key} from DDB:`, e);
      throw e;
    }
  }

  /**
   * Resolves the table name for the configured ConfigTable.
   */
  public static async resolveTableName(): Promise<string | undefined> {
    return this._getTableName();
  }

  /**
   * Atomically appends a value to a list configuration.
   */
  public static async appendToList(
    key: string,
    item: unknown,
    options?: { limit?: number; workspaceId?: string }
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) return;

    const effectiveKey = options?.workspaceId ? `WS#${options.workspaceId}#${key}` : key;
    this.configCache.delete(effectiveKey);

    try {
      const { limit } = options || {};
      await getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: 'SET #val = if_not_exists(#val, :empty_list)',
          ExpressionAttributeNames: { '#val': 'value' },
          ExpressionAttributeValues: { ':empty_list': [] },
        })
      );

      const result = await getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: 'SET #val = list_append(#val, :items)',
          ExpressionAttributeNames: { '#val': 'value' },
          ExpressionAttributeValues: { ':items': [item] },
          ReturnValues: 'ALL_NEW',
        })
      );

      const currentList = result.Attributes?.value as unknown[];
      if (limit && currentList && currentList.length > limit) {
        const excess = currentList.length - limit;
        await getDocClient()
          .send(
            new UpdateCommand({
              TableName: tableName,
              Key: { key: effectiveKey },
              UpdateExpression: `REMOVE ${Array.from({ length: excess }, (_, i) => `#val[${i}]`).join(', ')}`,
              ExpressionAttributeNames: { '#val': 'value' },
            })
          )
          .catch((e) => logger.debug(`List capping failed for ${effectiveKey}:`, e));
      }
    } catch (e) {
      logger.error(`Failed to append to list ${effectiveKey} in DDB:`, e);
      throw e;
    }
  }

  /**
   * Atomically increments a numeric configuration value.
   */
  public static async incrementConfig(key: string, increment: number = 1): Promise<number> {
    const tableName = this._getTableName();
    if (!tableName) return 0;

    this.configCache.delete(key);

    try {
      const result = await getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
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

  /**
   * Atomically updates a specific field for an entity within a map-based configuration.
   */
  public static async atomicUpdateMapField(
    key: string,
    entityId: string,
    field: string,
    value: unknown,
    options: { workspaceId?: string; retryCount?: number } = {}
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) return;

    const effectiveKey = options.workspaceId ? `WS#${options.workspaceId}#${key}` : key;
    this.configCache.delete(effectiveKey);

    const retryCount = options.retryCount ?? 0;
    const maxRetries = 3;
    const docClient = getDocClient();

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: 'SET #val.#id.#field = :value',
          ConditionExpression: 'attribute_exists(#val.#id)',
          ExpressionAttributeNames: { '#val': 'value', '#id': entityId, '#field': field },
          ExpressionAttributeValues: { ':value': value },
        })
      );
    } catch (e: unknown) {
      if (!(e instanceof Error)) throw e;
      if (e.name === 'ValidationException' || e.name === 'ConditionalCheckFailedException') {
        try {
          await docClient.send(
            new UpdateCommand({
              TableName: tableName,
              Key: { key: effectiveKey },
              UpdateExpression: 'SET #val.#id = :entityObj',
              ConditionExpression: 'attribute_not_exists(#val.#id)',
              ExpressionAttributeNames: { '#val': 'value', '#id': entityId },
              ExpressionAttributeValues: { ':entityObj': { [field]: value } },
            })
          );
        } catch (innerE: unknown) {
          if (!(innerE instanceof Error)) throw innerE;
          if (innerE.name === 'ValidationException') {
            try {
              await docClient.send(
                new UpdateCommand({
                  TableName: tableName,
                  Key: { key: effectiveKey },
                  UpdateExpression: 'SET #val = :rootObj',
                  ConditionExpression: 'attribute_not_exists(#val)',
                  ExpressionAttributeNames: { '#val': 'value' },
                  ExpressionAttributeValues: { ':rootObj': { [entityId]: { [field]: value } } },
                })
              );
            } catch (rootE: unknown) {
              if (
                rootE instanceof Error &&
                rootE.name === 'ConditionalCheckFailedException' &&
                retryCount < maxRetries
              ) {
                return this.atomicUpdateMapField(key, entityId, field, value, {
                  ...options,
                  retryCount: retryCount + 1,
                });
              }
              throw rootE;
            }
          } else if (innerE.name === 'ConditionalCheckFailedException' && retryCount < maxRetries) {
            return this.atomicUpdateMapField(key, entityId, field, value, {
              ...options,
              retryCount: retryCount + 1,
            });
          } else {
            throw innerE;
          }
        }
      } else {
        throw e;
      }
    }
  }

  /**
   * Atomically appends items to a list in the ConfigTable.
   * Ensures the list exists and prevents duplicates if desired.
   */
  public static async atomicAppendToList(
    key: string,
    items: any[],
    options: { workspaceId?: string; preventDuplicates?: boolean } = {}
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) return;

    const effectiveKey = options.workspaceId ? `WS#${options.workspaceId}#${key}` : key;
    this.configCache.delete(effectiveKey);

    const docClient = getDocClient();

    // preventDuplicates logic requires current list
    if (options.preventDuplicates) {
      const current = await this.getTypedConfig<any[]>(key, [], options);
      const filtered = items.filter((item) => !current.includes(item));
      if (filtered.length === 0) return;
      items = filtered;
    }

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: 'SET #val = list_append(if_not_exists(#val, :empty), :items)',
          ExpressionAttributeNames: { '#val': 'value' },
          ExpressionAttributeValues: {
            ':items': items,
            ':empty': [],
          },
        })
      );
    } catch (e) {
      logger.error(`Failed to atomically append to list ${effectiveKey}:`, e);
      throw e;
    }
  }

  /**
   * Atomically adds/subtracts a value for a specific field for an entity within a map-based configuration.
   */
  public static async atomicAddMapField(
    key: string,
    entityId: string,
    field: string,
    delta: number,
    options: { workspaceId?: string } = {}
  ): Promise<number> {
    const tableName = this._getTableName();
    if (!tableName) return 0;

    const effectiveKey = options.workspaceId ? `WS#${options.workspaceId}#${key}` : key;
    this.configCache.delete(effectiveKey);

    try {
      const result = await getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: 'SET #val.#id.#field = if_not_exists(#val.#id.#field, :zero) + :delta',
          ExpressionAttributeNames: { '#val': 'value', '#id': entityId, '#field': field },
          ExpressionAttributeValues: { ':delta': delta, ':zero': 0 },
          ReturnValues: 'ALL_NEW',
        })
      );
      return result.Attributes?.value?.[entityId]?.[field] ?? 0;
    } catch (e: unknown) {
      logger.error(`Failed to atomically add ${delta} to ${effectiveKey}/${entityId}.${field}:`, e);
      throw e;
    }
  }

  /**
   * Atomically updates a specific field for an entity with a conditional check on the current value.
   */
  public static async atomicUpdateMapFieldWithCondition(
    key: string,
    entityId: string,
    field: string,
    value: unknown,
    expectedValue: unknown
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) return;

    this.configCache.delete(key);

    try {
      await getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key },
          UpdateExpression: 'SET #val.#id.#field = :value',
          ConditionExpression: '#val.#id.#field = :expected',
          ExpressionAttributeNames: { '#val': 'value', '#id': entityId, '#field': field },
          ExpressionAttributeValues: { ':value': value, ':expected': expectedValue },
        })
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') throw e;
      logger.error(`Failed to atomically update ${key}/${entityId}.${field}:`, e);
      throw e;
    }
  }

  /**
   * Atomically removes items from a top-level list in the ConfigTable.
   * Implements a retry loop to handle concurrent updates.
   */
  public static async atomicRemoveFromList(
    key: string,
    itemsToRemove: any[],
    options: { workspaceId?: string } = {}
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) return;

    const effectiveKey = options.workspaceId ? `WS#${options.workspaceId}#${key}` : key;
    this.configCache.delete(effectiveKey);

    const docClient = getDocClient();
    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount < maxRetries) {
      try {
        const current = await this.getTypedConfig<any[]>(key, [], options);
        const newList = current.filter((item) => !itemsToRemove.includes(item));

        if (newList.length === current.length) return;

        await docClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { key: effectiveKey },
            UpdateExpression: 'SET #val = :newList',
            ConditionExpression: '#val = :oldList',
            ExpressionAttributeNames: { '#val': 'value' },
            ExpressionAttributeValues: {
              ':newList': newList,
              ':oldList': current,
            },
          })
        );
        return;
      } catch (e: any) {
        if (e.name === 'ConditionalCheckFailedException') {
          this.configCache.delete(effectiveKey);
          retryCount++;
          continue;
        }
        logger.error(`Failed to atomically remove from list ${effectiveKey}:`, e);
        throw e;
      }
    }
    throw new Error(
      `Failed to atomically remove from list ${effectiveKey} after ${maxRetries} retries`
    );
  }

  /**
   * Removes items from a list within a map entity atomically using conditional updates.
   */
  public static async atomicRemoveFromMap(
    key: string,
    entityId: string,
    itemsToRemove: unknown[],
    options: { workspaceId?: string } = {}
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) return;

    const effectiveKey = options.workspaceId ? `WS#${options.workspaceId}#${key}` : key;
    this.configCache.delete(effectiveKey);

    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount < maxRetries) {
      try {
        const { Item } = await getDocClient().send(
          new GetCommand({
            TableName: tableName,
            Key: { key: effectiveKey },
            ProjectionExpression: '#val.#id',
            ExpressionAttributeNames: { '#val': 'value', '#id': entityId },
          })
        );

        const currentMap = Item?.value as Record<string, unknown[]>;
        const currentList = currentMap?.[entityId];
        if (!Array.isArray(currentList)) return;

        const newList = currentList.filter(
          (item) =>
            !itemsToRemove.some((toRemove) => JSON.stringify(item) === JSON.stringify(toRemove))
        );
        if (newList.length === currentList.length) return;

        await getDocClient().send(
          new UpdateCommand({
            TableName: tableName,
            Key: { key: effectiveKey },
            UpdateExpression: 'SET #val.#id = :newList',
            ConditionExpression: '#val.#id = :oldList',
            ExpressionAttributeNames: { '#val': 'value', '#id': entityId },
            ExpressionAttributeValues: { ':newList': newList, ':oldList': currentList },
          })
        );
        return;
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
          retryCount++;
          continue;
        }
        throw e;
      }
    }
  }

  public static async atomicRemoveFromMapList(
    key: string,
    entityId: string,
    field: string,
    itemsToRemove: unknown[],
    options: { workspaceId?: string } = {}
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) return;

    const effectiveKey = options.workspaceId ? `WS#${options.workspaceId}#${key}` : key;
    this.configCache.delete(effectiveKey);

    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount < maxRetries) {
      try {
        const { Item } = await getDocClient().send(
          new GetCommand({
            TableName: tableName,
            Key: { key: effectiveKey },
            ProjectionExpression: '#val.#id.#field',
            ExpressionAttributeNames: { '#val': 'value', '#id': entityId, '#field': field },
          })
        );

        const currentMap = Item?.value as Record<string, Record<string, unknown[]>>;
        const currentList = currentMap?.[entityId]?.[field];

        if (!Array.isArray(currentList)) return;

        const newList = currentList.filter(
          (item) =>
            !itemsToRemove.some((toRemove) => JSON.stringify(item) === JSON.stringify(toRemove))
        );
        if (newList.length === currentList.length) return;

        await getDocClient().send(
          new UpdateCommand({
            TableName: tableName,
            Key: { key: effectiveKey },
            UpdateExpression: 'SET #val.#id.#field = :newList',
            ConditionExpression: '#val.#id.#field = :oldList',
            ExpressionAttributeNames: { '#val': 'value', '#id': entityId, '#field': field },
            ExpressionAttributeValues: { ':newList': newList, ':oldList': currentList },
          })
        );
        return;
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
          retryCount++;
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * Atomically updates multiple fields for an entity using a partial object.
   */
  public static async atomicUpdateMapEntity(
    key: string,
    entityId: string,
    updates: Record<string, unknown>,
    options?: { workspaceId?: string; orgId?: string; retryCount?: number }
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) return;

    let actualKey = key;
    if (options?.workspaceId) {
      actualKey = `WS#${options.workspaceId}#${key}`;
    } else if (options?.orgId) {
      actualKey = `ORG#${options.orgId}#${key}`;
    }
    this.configCache.delete(actualKey);

    const retryCount = options?.retryCount ?? 0;
    const maxRetries = 3;
    const docClient = getDocClient();
    const sets: string[] = [];
    const names: Record<string, string> = { '#val': 'value', '#id': entityId };
    const values: Record<string, unknown> = {};

    Object.entries(updates).forEach(([field, value], i) => {
      sets.push(`#val.#id.#f${i} = :v${i}`);
      names[`#f${i}`] = field;
      values[`:v${i}`] = value;
    });

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: actualKey },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: 'attribute_exists(#val.#id)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        })
      );
    } catch (e: unknown) {
      if (!(e instanceof Error)) throw e;
      if (e.name === 'ValidationException' || e.name === 'ConditionalCheckFailedException') {
        try {
          // Entity doesn't exist - create entity object
          await docClient.send(
            new UpdateCommand({
              TableName: tableName,
              Key: { key: actualKey },
              UpdateExpression: 'SET #val.#id = :entity',
              ConditionExpression: 'attribute_not_exists(#val.#id)',
              ExpressionAttributeNames: { '#val': 'value', '#id': entityId },
              ExpressionAttributeValues: { ':entity': updates },
            })
          );
        } catch (innerE: unknown) {
          if (!(innerE instanceof Error)) throw innerE;
          if (innerE.name === 'ValidationException') {
            try {
              // Root 'value' doesn't exist - create map object
              await docClient.send(
                new UpdateCommand({
                  TableName: tableName,
                  Key: { key: actualKey },
                  UpdateExpression: 'SET #val = :rootObj',
                  ConditionExpression: 'attribute_not_exists(#val)',
                  ExpressionAttributeNames: { '#val': 'value' },
                  ExpressionAttributeValues: { ':rootObj': { [entityId]: updates } },
                })
              );
            } catch (rootE: unknown) {
              if (
                rootE instanceof Error &&
                rootE.name === 'ConditionalCheckFailedException' &&
                retryCount < maxRetries
              ) {
                return this.atomicUpdateMapEntity(key, entityId, updates, {
                  ...options,
                  retryCount: retryCount + 1,
                  orgId: options?.orgId,
                });
              }
              throw rootE;
            }
          } else if (innerE.name === 'ConditionalCheckFailedException' && retryCount < maxRetries) {
            return this.atomicUpdateMapEntity(key, entityId, updates, {
              ...options,
              retryCount: retryCount + 1,
              orgId: options?.orgId,
            });
          } else {
            throw innerE;
          }
        }
      } else {
        throw e;
      }
    }
  }

  /**
   * Atomically increments a numeric field within a map entity.
   * Implements Principle 15 (Monotonic Progress).
   */
  public static async atomicIncrementMapField(
    key: string,
    entityId: string,
    field: string,
    delta: number,
    options: { workspaceId?: string; min?: number; max?: number } = {}
  ): Promise<number> {
    const tableName = this._getTableName();
    if (!tableName) throw new Error('ConfigTable not linked');

    const effectiveKey = options.workspaceId ? `WS#${options.workspaceId}#${key}` : key;
    this.configCache.delete(effectiveKey);

    const { UpdateCommand, GetCommand } = await import('@aws-sdk/lib-dynamodb');

    let retryCount = 0;
    while (retryCount < 5) {
      try {
        const { Item } = await getDocClient().send(
          new GetCommand({
            TableName: tableName,
            Key: { key: effectiveKey },
          })
        );
        const current = Item?.value as Record<string, Record<string, unknown>>;
        const entity = current?.[entityId] || {};
        const currentValue = (entity[field] as number) ?? 0;

        let newValue = currentValue + delta;
        if (options.min !== undefined) newValue = Math.max(options.min, newValue);
        if (options.max !== undefined) newValue = Math.min(options.max, newValue);

        if (newValue === currentValue) return currentValue;

        await getDocClient().send(
          new UpdateCommand({
            TableName: tableName,
            Key: { key: effectiveKey },
            UpdateExpression: `SET #val.#id.#field = :newVal`,
            ConditionExpression:
              'attribute_exists(#val.#id) AND (#val.#id.#field = :oldVal OR (attribute_not_exists(#val.#id.#field) AND :oldVal = :zero))',
            ExpressionAttributeNames: {
              '#val': 'value',
              '#id': entityId,
              '#field': field,
            },
            ExpressionAttributeValues: {
              ':newVal': newValue,
              ':oldVal': currentValue,
              ':zero': 0,
            },
          })
        );
        return newValue;
      } catch (e: unknown) {
        const err = e as { name?: string };
        if (err.name === 'ConditionalCheckFailedException') {
          retryCount++;
          continue;
        }
        throw e;
      }
    }
    throw new Error(`Failed to atomically increment ${field} after ${retryCount} retries`);
  }
}
