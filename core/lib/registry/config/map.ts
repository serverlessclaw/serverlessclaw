import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../logger';
import { ConfigManagerList } from './list';
import { getDocClient } from './client';

/**
 * Map and entity-specific configuration management operations.
 */
export class ConfigManagerMap extends ConfigManagerList {
  /**
   * Fetches a specific entity from a map-based configuration.
   */
  public static async getMapEntity<T = Record<string, unknown>>(
    key: string,
    entityId: string,
    options?: { workspaceId?: string; orgId?: string }
  ): Promise<T | undefined> {
    const rootMap = await this.getRawConfig(key, options);
    if (!rootMap || typeof rootMap !== 'object') return undefined;
    return (rootMap as Record<string, T>)[entityId];
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
    options: {
      workspaceId?: string;
      min?: number;
      max?: number;
      retryCount?: number;
      conditionExpression?: string;
      expressionAttributeNames?: Record<string, string>;
      expressionAttributeValues?: Record<string, unknown>;
    } = {}
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
      let conditionExpression = 'attribute_exists(#val.#id)';
      if (options.conditionExpression) {
        conditionExpression = `(${conditionExpression}) AND (${options.conditionExpression})`;
      }

      const result = await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: 'SET #val.#id.#field = if_not_exists(#val.#id.#field, :zero) + :delta',
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames: {
            '#val': 'value',
            '#id': entityId,
            '#field': field,
            ...(options.expressionAttributeNames || {}),
          },
          ExpressionAttributeValues: {
            ':delta': delta,
            ':zero': 0,
            ...(options.expressionAttributeValues || {}),
          },
          ReturnValues: 'ALL_NEW',
        })
      );
      const newValue = result.Attributes?.value?.[entityId]?.[field] ?? 0;

      // Clamping if needed (Principle 15: Monotonic Progress)
      if (newValue < min || newValue > max) {
        const clamped = Math.min(Math.max(newValue, min), max);
        const condition = newValue < min ? '#val.#id.#field < :min' : '#val.#id.#field > :max';
        try {
          await docClient.send(
            new UpdateCommand({
              TableName: tableName,
              Key: { key: effectiveKey },
              UpdateExpression: 'SET #val.#id.#field = :clamped',
              ConditionExpression: `attribute_exists(#val.#id) AND (${condition})`,
              ExpressionAttributeNames: { '#val': 'value', '#id': entityId, '#field': field },
              ExpressionAttributeValues: {
                ':clamped': clamped,
                ':min': min,
                ':max': max,
              },
            })
          );
          return clamped;
        } catch (clampError: unknown) {
          if (
            clampError instanceof Error &&
            clampError.name === 'ConditionalCheckFailedException'
          ) {
            // Value was corrected or changed back into range concurrently - fetch fresh state
            const fresh = await this.getMapEntity(key, entityId, {
              workspaceId: options.workspaceId,
            });
            return (fresh?.[field] as number) ?? clamped;
          }
          throw clampError;
        }
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
   * Atomically removes multiple fields from a flat map configuration.
   */
  public static async atomicRemoveFieldsFromMap(
    key: string,
    fields: string[],
    options: { workspaceId?: string } = {}
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName || fields.length === 0) return;

    const effectiveKey = this.getEffectiveKey(key, options);
    this.configCache.delete(effectiveKey);

    const docClient = getDocClient();
    const names: Record<string, string> = { '#val': 'value' };
    const expressions: string[] = [];

    fields.forEach((field, idx) => {
      const fieldId = `#f${idx}`;
      names[fieldId] = field;
      expressions.push(`#val.${fieldId}`);
    });

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: `REMOVE ${expressions.join(', ')}`,
          ExpressionAttributeNames: names,
        })
      );
    } catch (e) {
      logger.error(`Failed to remove fields from map ${effectiveKey}:`, e);
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

  /**
   * Atomically appends items to a list within a map entity using conditional updates.
   */
  public static async atomicAppendToMapList(
    key: string,
    entityId: string,
    newItems: unknown[],
    options: { workspaceId?: string; preventDuplicates?: boolean } = {}
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
        const currentList = currentMap?.[entityId] || [];
        if (!Array.isArray(currentList)) {
          throw new Error(`Field ${entityId} in map ${key} is not a list`);
        }

        let itemsToAdd = newItems;
        if (options.preventDuplicates) {
          itemsToAdd = newItems.filter(
            (item) =>
              !currentList.some((existing) => JSON.stringify(existing) === JSON.stringify(item))
          );
        }

        if (itemsToAdd.length === 0) return;

        const newList = [...currentList, ...itemsToAdd];

        await getDocClient().send(
          new UpdateCommand({
            TableName: tableName,
            Key: { key: effectiveKey },
            UpdateExpression: 'SET #val.#id = :newList',
            ConditionExpression: 'attribute_not_exists(#val.#id) OR #val.#id = :oldList',
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
        // If the map itself doesn't exist, try to create it
        if (e instanceof Error && e.name === 'ValidationException') {
          try {
            await getDocClient().send(
              new UpdateCommand({
                TableName: tableName,
                Key: { key: effectiveKey },
                UpdateExpression: 'SET #val = :newMap',
                ConditionExpression: 'attribute_not_exists(#val)',
                ExpressionAttributeNames: { '#val': 'value' },
                ExpressionAttributeValues: { ':newMap': { [entityId]: newItems } },
              })
            );
            return;
          } catch (innerE: unknown) {
            if (innerE instanceof Error && innerE.name === 'ConditionalCheckFailedException') {
              retryCount++;
              continue;
            }
            throw innerE;
          }
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
      conditionExpression?: string;
      expressionAttributeNames?: Record<string, string>;
      expressionAttributeValues?: Record<string, unknown>;
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
    const names: Record<string, string> = {
      '#val': 'value',
      '#id': entityId,
      ...(options?.expressionAttributeNames || {}),
    };
    const values: Record<string, unknown> = {
      ...(options?.expressionAttributeValues || {}),
    };

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
    let conditionExpression = 'attribute_exists(#val.#id)';
    if (options?.conditionExpression) {
      conditionExpression = `(${conditionExpression}) AND (${options.conditionExpression})`;
    }

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: actualKey },
          UpdateExpression: updateExpression,
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        })
      );
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        (e.name === 'ValidationException' || e.name === 'ConditionalCheckFailedException')
      ) {
        // If we had a custom condition and it failed, we shouldn't attempt the fallbacks
        // as they are meant for "attribute_exists" failures (entity/root map not existing).
        if (
          e.name === 'ConditionalCheckFailedException' &&
          options?.conditionExpression &&
          !e.message.includes('attribute_exists')
        ) {
          throw e;
        }

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
