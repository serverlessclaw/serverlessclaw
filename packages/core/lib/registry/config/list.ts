import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../logger';
import { ConfigManagerBase } from './base';
import { getDocClient } from './client';

/**
 * List-specific configuration management operations.
 */
export class ConfigManagerList extends ConfigManagerBase {
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

    const effectiveKey = this.getEffectiveKey(key, options);
    this.configCache.delete(effectiveKey);

    try {
      const { limit } = options || {};

      const result = await getDocClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: { key: effectiveKey },
          UpdateExpression: 'SET #val = list_append(if_not_exists(#val, :empty_list), :items)',
          ExpressionAttributeNames: { '#val': 'value' },
          ExpressionAttributeValues: {
            ':empty_list': [],
            ':items': [item],
          },
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
   * Atomically appends items to a list in the ConfigTable.
   */
  public static async atomicAppendToList(
    key: string,
    items: unknown[],
    options: { workspaceId?: string; preventDuplicates?: boolean } = {}
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) return;

    const effectiveKey = this.getEffectiveKey(key, options);
    this.configCache.delete(effectiveKey);

    const docClient = getDocClient();

    if (options.preventDuplicates) {
      const current = await this.getTypedConfig<unknown[]>(key, [], options);
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
   * Atomically removes items from a top-level list in the ConfigTable.
   */
  public static async atomicRemoveFromList(
    key: string,
    itemsToRemove: unknown[],
    options: { workspaceId?: string } = {}
  ): Promise<void> {
    const tableName = this._getTableName();
    if (!tableName) return;

    const effectiveKey = this.getEffectiveKey(key, options);
    this.configCache.delete(effectiveKey);

    const docClient = getDocClient();
    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount < maxRetries) {
      try {
        const current = await this.getTypedConfig<unknown[]>(key, [], options);
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
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
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
}
