import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../logger';
import { ConfigManagerList } from './list';
import { getDocClient } from './client';

/**
 * Map and entity-specific configuration management operations.
 */
export class ConfigManagerMap extends ConfigManagerList {
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

    const effectiveKey = this.getEffectiveKey(key, options);
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
      if (
        e instanceof Error &&
        (e.name === 'ValidationException' || e.name === 'ConditionalCheckFailedException')
      ) {
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
          if (innerE instanceof Error && innerE.name === 'ValidationException') {
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
          } else if (
            innerE instanceof Error &&
            innerE.name === 'ConditionalCheckFailedException' &&
            retryCount < maxRetries
          ) {
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
   * Atomically adds/subtracts a value for a specific field for an entity within a map-based configuration.
   */
  public static async atomicAddMapField(
    key: string,
    entityId: string,
    field: string,
    delta: number,
    options: { workspaceId?: string; retryCount?: number } = {}
  ): Promise<number> {
    const tableName = this._getTableName();
    if (!tableName) return 0;

    const effectiveKey = this.getEffectiveKey(key, options);
    this.configCache.delete(effectiveKey);

    const retryCount = options.retryCount ?? 0;
    const maxRetries = 3;
    const docClient = getDocClient();

    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: 'SET #val.#id.#field = if_not_exists(#val.#id.#field, :zero) + :delta',
          ConditionExpression: 'attribute_exists(#val.#id)',
          ExpressionAttributeNames: { '#val': 'value', '#id': entityId, '#field': field },
          ExpressionAttributeValues: { ':delta': delta, ':zero': 0 },
          ReturnValues: 'ALL_NEW',
        })
      );
      return result.Attributes?.value?.[entityId]?.[field] ?? 0;
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        (e.name === 'ValidationException' || e.name === 'ConditionalCheckFailedException')
      ) {
        try {
          // Fallback 1: Try to create the entity object within the map
          await docClient.send(
            new UpdateCommand({
              TableName: tableName,
              Key: { key: effectiveKey },
              UpdateExpression: 'SET #val.#id = :entityObj',
              ConditionExpression: 'attribute_not_exists(#val.#id)',
              ExpressionAttributeNames: { '#val': 'value', '#id': entityId },
              ExpressionAttributeValues: { ':entityObj': { [field]: delta } },
            })
          );
          return delta;
        } catch (innerE: unknown) {
          if (innerE instanceof Error && innerE.name === 'ValidationException') {
            try {
              // Fallback 2: Try to create the root map object
              await docClient.send(
                new UpdateCommand({
                  TableName: tableName,
                  Key: { key: effectiveKey },
                  UpdateExpression: 'SET #val = :rootObj',
                  ConditionExpression: 'attribute_not_exists(#val)',
                  ExpressionAttributeNames: { '#val': 'value' },
                  ExpressionAttributeValues: { ':rootObj': { [entityId]: { [field]: delta } } },
                })
              );
              return delta;
            } catch (rootE: unknown) {
              if (
                rootE instanceof Error &&
                rootE.name === 'ConditionalCheckFailedException' &&
                retryCount < maxRetries
              ) {
                return this.atomicAddMapField(key, entityId, field, delta, {
                  ...options,
                  retryCount: retryCount + 1,
                });
              }
              throw rootE;
            }
          } else if (
            innerE instanceof Error &&
            innerE.name === 'ConditionalCheckFailedException' &&
            retryCount < maxRetries
          ) {
            return this.atomicAddMapField(key, entityId, field, delta, {
              ...options,
              retryCount: retryCount + 1,
            });
          } else {
            throw innerE;
          }
        }
      }
      logger.error(`Failed to atomically add ${delta} to ${effectiveKey}/${entityId}.${field}:`, e);
      throw e;
    }
  }

  /**
   * Atomically increments a numeric field for an entity within a map configuration.
   * Supports optional min/max clamping.
   */
  public static async atomicIncrementMapField(
    key: string,
    entityId: string,
    field: string,
    delta: number,
    options: { workspaceId?: string; min?: number; max?: number; retryCount?: number } = {}
  ): Promise<number> {
    const tableName = this._getTableName();
    if (!tableName) return 0;

    const effectiveKey = this.getEffectiveKey(key, options);
    this.configCache.delete(effectiveKey);

    const retryCount = options.retryCount ?? 0;
    const maxRetries = 3;
    const docClient = getDocClient();
    const { min = -Infinity, max = Infinity } = options;

    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: 'SET #val.#id.#field = if_not_exists(#val.#id.#field, :zero) + :delta',
          ConditionExpression: 'attribute_exists(#val.#id)',
          ExpressionAttributeNames: { '#val': 'value', '#id': entityId, '#field': field },
          ExpressionAttributeValues: { ':delta': delta, ':zero': 0 },
          ReturnValues: 'ALL_NEW',
        })
      );
      const newValue = result.Attributes?.value?.[entityId]?.[field] ?? 0;

      // Clamping if needed
      if (newValue < min || newValue > max) {
        const clamped = Math.min(Math.max(newValue, min), max);
        await this.atomicUpdateMapField(key, entityId, field, clamped, options);
        return clamped;
      }

      return newValue;
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        (e.name === 'ValidationException' || e.name === 'ConditionalCheckFailedException')
      ) {
        try {
          const initialValue = Math.min(Math.max(delta, min), max);
          await docClient.send(
            new UpdateCommand({
              TableName: tableName,
              Key: { key: effectiveKey },
              UpdateExpression: 'SET #val.#id = :entityObj',
              ConditionExpression: 'attribute_not_exists(#val.#id)',
              ExpressionAttributeNames: { '#val': 'value', '#id': entityId },
              ExpressionAttributeValues: { ':entityObj': { [field]: initialValue } },
            })
          );
          return initialValue;
        } catch (innerE: unknown) {
          if (innerE instanceof Error && innerE.name === 'ValidationException') {
            try {
              const initialValue = Math.min(Math.max(delta, min), max);
              await docClient.send(
                new UpdateCommand({
                  TableName: tableName,
                  Key: { key: effectiveKey },
                  UpdateExpression: 'SET #val = :rootObj',
                  ConditionExpression: 'attribute_not_exists(#val)',
                  ExpressionAttributeNames: { '#val': 'value' },
                  ExpressionAttributeValues: {
                    ':rootObj': { [entityId]: { [field]: initialValue } },
                  },
                })
              );
              return initialValue;
            } catch (rootE: unknown) {
              if (
                rootE instanceof Error &&
                rootE.name === 'ConditionalCheckFailedException' &&
                retryCount < maxRetries
              ) {
                return this.atomicIncrementMapField(key, entityId, field, delta, {
                  ...options,
                  retryCount: retryCount + 1,
                });
              }
              throw rootE;
            }
          } else if (
            innerE instanceof Error &&
            innerE.name === 'ConditionalCheckFailedException' &&
            retryCount < maxRetries
          ) {
            return this.atomicIncrementMapField(key, entityId, field, delta, {
              ...options,
              retryCount: retryCount + 1,
            });
          } else {
            throw innerE;
          }
        }
      }
      logger.error(
        `Failed to atomically increment ${effectiveKey}/${entityId}.${field} by ${delta}:`,
        e
      );
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
    expectedValue: unknown,
    options: { workspaceId?: string } = {}
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) return;

    const effectiveKey = this.getEffectiveKey(key, options);
    this.configCache.delete(effectiveKey);

    try {
      await getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: 'SET #val.#id.#field = :value',
          ConditionExpression: '#val.#id.#field = :expected',
          ExpressionAttributeNames: { '#val': 'value', '#id': entityId, '#field': field },
          ExpressionAttributeValues: { ':value': value, ':expected': expectedValue },
        })
      );
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') throw e;
      logger.error(`Failed to atomically update ${effectiveKey}/${entityId}.${field}:`, e);
      throw e;
    }
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

    const effectiveKey = this.getEffectiveKey(key, options);
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

    const effectiveKey = this.getEffectiveKey(key, options);
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
    options?: {
      workspaceId?: string;
      orgId?: string;
      retryCount?: number;
      increments?: Record<string, number>;
    }
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) return;

    const actualKey = this.getEffectiveKey(key, options);
    this.configCache.delete(actualKey);

    const retryCount = options?.retryCount ?? 0;
    const maxRetries = 3;
    const docClient = getDocClient();
    const sets: string[] = [];
    const names: Record<string, string> = { '#val': 'value', '#id': entityId };
    const values: Record<string, unknown> = {};

    let valIdx = 0;
    Object.entries(updates).forEach(([field, value]) => {
      sets.push(`#val.#id.#f${valIdx} = :v${valIdx}`);
      names[`#f${valIdx}`] = field;
      values[`:v${valIdx}`] = value;
      valIdx++;
    });

    if (options?.increments) {
      Object.entries(options.increments).forEach(([field, delta]) => {
        sets.push(
          `#val.#id.#f${valIdx} = if_not_exists(#val.#id.#f${valIdx}, :zero) + :v${valIdx}`
        );
        names[`#f${valIdx}`] = field;
        values[`:v${valIdx}`] = delta;
        values[':zero'] = 0;
        valIdx++;
      });
    }

    const updateExpression = `SET ${sets.join(', ')}`;

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: actualKey },
          UpdateExpression: updateExpression,
          ConditionExpression: 'attribute_exists(#val.#id)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        })
      );
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        (e.name === 'ValidationException' || e.name === 'ConditionalCheckFailedException')
      ) {
        try {
          const initialObject = { ...updates };
          if (options?.increments) {
            Object.entries(options.increments).forEach(([field, delta]) => {
              initialObject[field] = delta;
            });
          }

          await docClient.send(
            new UpdateCommand({
              TableName: tableName,
              Key: { key: actualKey },
              UpdateExpression: 'SET #val.#id = :entity',
              ConditionExpression: 'attribute_not_exists(#val.#id)',
              ExpressionAttributeNames: { '#val': 'value', '#id': entityId },
              ExpressionAttributeValues: { ':entity': initialObject },
            })
          );
        } catch (innerE: unknown) {
          if (innerE instanceof Error && innerE.name === 'ValidationException') {
            try {
              const initialObject = { ...updates };
              if (options?.increments) {
                Object.entries(options.increments).forEach(([field, delta]) => {
                  initialObject[field] = delta;
                });
              }

              await docClient.send(
                new UpdateCommand({
                  TableName: tableName,
                  Key: { key: actualKey },
                  UpdateExpression: 'SET #val = :rootObj',
                  ConditionExpression: 'attribute_not_exists(#val)',
                  ExpressionAttributeNames: { '#val': 'value' },
                  ExpressionAttributeValues: { ':rootObj': { [entityId]: initialObject } },
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
                });
              }
              throw rootE;
            }
          } else if (
            innerE instanceof Error &&
            innerE.name === 'ConditionalCheckFailedException' &&
            retryCount < maxRetries
          ) {
            return this.atomicUpdateMapEntity(key, entityId, updates, {
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
}
