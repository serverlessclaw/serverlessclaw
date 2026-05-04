import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConfigManagerMapAtomic } from './map-atomic';
import { getDocClient } from './client';

/**
 * Collection-based atomic operations for maps (lists within map entities).
 */
export class ConfigManagerMapCollections extends ConfigManagerMapAtomic {
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

  /**
   * Atomically removes items from a list within a field of a map entity.
   */
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
}
