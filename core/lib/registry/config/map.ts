import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../logger';
import { ConfigManagerMapCollections } from './map-collections';
import { getDocClient } from './client';

/**
 * Map and entity-specific configuration management operations.
 */
export class ConfigManagerMap extends ConfigManagerMapCollections {
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
}
