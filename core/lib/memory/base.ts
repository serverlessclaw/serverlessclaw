import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

import { logger } from '../logger';
import { getMemoryTableName } from '../utils/ddb-client';

// Default client for backward compatibility - can be overridden via constructor for testing
const defaultClient = new DynamoDBClient({});
const defaultDocClient = DynamoDBDocumentClient.from(defaultClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

/**
 * Base logic for DynamoDB interactions within the memory system.
 * Focused on low-level CRUD operations and workspace scoping.
 * @since 2026-03-19
 */
export class BaseMemoryProvider {
  protected readonly docClient: DynamoDBDocumentClient;

  /**
   * Creates a new BaseMemoryProvider.
   * @param docClient - Optional DynamoDB Document Client for dependency injection (useful for testing)
   */
  constructor(docClient?: DynamoDBDocumentClient) {
    this.docClient = docClient ?? defaultDocClient;
  }

  /**
   * Public getter for the table name.
   */
  public getTableName(): string | undefined {
    return this.tableName;
  }

  /**
   * Public getter for the doc client.
   */
  public getDocClient(): DynamoDBDocumentClient {
    return this.docClient;
  }

  /**
   * Resolves table name lazily.
   *
   * @returns The resolved table name string.
   */
  protected get tableName(): string | undefined {
    return getMemoryTableName();
  }

  /**
   * Helper to derive a workspace-scoped userId for DynamoDB partition keys.
   * Format: WS#[orgId]#[teamId]#[staffId]#[workspaceId]#userId
   * If any scope identifiers are provided, prefixes the userId to ensure logical isolation.
   *
   * @param userId - The base user identifier.
   * @param scope - Optional scope identifier or ContextualScope object.
   * @returns The scoped partition key string.
   */
  public getScopedUserId(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ): string {
    if (!scope) return userId;

    let workspaceId: string | undefined;
    let teamId: string | undefined;
    let staffId: string | undefined;

    if (typeof scope === 'string') {
      workspaceId = scope;
    } else {
      workspaceId = scope.workspaceId;
      teamId = scope.teamId;
      staffId = scope.staffId;
    }

    if (!workspaceId && !teamId && !staffId) return userId;

    // Validation: userId should not contain workspace prefix characters to prevent spoofing
    if (userId.includes('WS#')) {
      logger.warn(`[SECURITY] Potential workspace prefix spoofing attempt in userId: ${userId}`);
      // Strip any existing WS#...# prefix to ensure target scope takes precedence
      userId = userId.replace(/^WS#.*?#/g, '');
    }

    const segments = ['WS'];
    if (teamId) segments.push(`TEAM:${teamId}`);
    if (staffId) segments.push(`STAFF:${staffId}`);

    if (workspaceId) {
      if (segments.length === 1) {
        // Backward compatibility for plain workspaceId
        return `WS#${workspaceId}#${userId}`;
      }
      segments.push(`WSID:${workspaceId}`);
    }

    return `${segments.join('#')}#${userId}`;
  }

  /**
   * Internal helper to put an item into DynamoDB.
   *
   * @param item - The item object to store.
   * @returns A promise resolving when the operation is complete.
   */
  public async putItem(
    item: Record<string, unknown>,
    params?: Partial<
      Pick<
        import('@aws-sdk/lib-dynamodb').PutCommandInput,
        'ConditionExpression' | 'ExpressionAttributeNames' | 'ExpressionAttributeValues'
      >
    >
  ): Promise<void> {
    const tableName = this.tableName;
    if (!tableName) return;

    const command = new PutCommand({
      TableName: tableName,
      Item: {
        ...item,
        attachments: (item.attachments as unknown[]) ?? [],
        tool_calls: (item.tool_calls as unknown[]) ?? [],
      },
      ...params,
    });
    try {
      await this.docClient.send(command);
    } catch (error) {
      const errorName = (error as Error).name || 'UnknownError';
      const { emitMetrics, METRICS } = await import('../metrics/metrics');
      const workspaceId = (item as any).workspaceId || undefined;
      await emitMetrics([
        METRICS.storageError('putItem', errorName, tableName, { workspaceId }),
      ]).catch(() => {});
      logger.error('Error putting item into DynamoDB:', error);
      throw error;
    }
  }

  /**
   * Internal helper for Query commands.
   *
   * @param params - The DynamoDB QueryCommand parameters.
   * @returns A promise resolving to an object containing items and an optional LastEvaluatedKey.
   */
  public async queryItemsPaginated(params: Record<string, unknown>): Promise<{
    items: Record<string, unknown>[];
    lastEvaluatedKey?: Record<string, unknown>;
  }> {
    const tableName = this.tableName;
    if (!tableName) return { items: [] };

    const command = new QueryCommand({
      TableName: tableName,
      ...params,
    });
    try {
      const response = await this.docClient.send(command);
      return {
        items: (response.Items as Record<string, unknown>[]) ?? [],
        lastEvaluatedKey: response.LastEvaluatedKey,
      };
    } catch (error) {
      const errorName = (error as Error).name || 'UnknownError';
      const { emitMetrics, METRICS } = await import('../metrics/metrics');
      const workspaceId = (params as any).ExpressionAttributeValues?.[':workspaceId'];
      await emitMetrics([
        METRICS.storageError('queryItems', errorName, tableName, { workspaceId }),
      ]).catch(() => {});
      logger.error('Error querying DynamoDB:', error);
      throw error;
    }
  }

  /**
   * Internal helper for Query commands (legacy non-paginated).
   *
   * @param params - The DynamoDB QueryCommand parameters.
   * @returns A promise resolving to an array of items.
   */
  public async queryItems(params: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const { items } = await this.queryItemsPaginated(params);
    return items;
  }

  /**
   * Internal helper for Delete commands.
   *
   * @param params - The primary key of the item to delete, plus optional conditions.
   * @returns A promise resolving when the operation is complete.
   */
  public async deleteItem(
    params: {
      userId: string;
      timestamp: number | string;
    } & Partial<
      Pick<
        import('@aws-sdk/lib-dynamodb').DeleteCommandInput,
        'ConditionExpression' | 'ExpressionAttributeNames' | 'ExpressionAttributeValues'
      >
    >
  ): Promise<void> {
    const tableName = this.tableName;
    if (!tableName) return;

    const { userId, timestamp, ...conditions } = params;
    try {
      await this.docClient.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { userId, timestamp },
          ...conditions,
        })
      );
    } catch (error) {
      const errorName = (error as Error).name || 'UnknownError';
      const { emitMetrics, METRICS } = await import('../metrics/metrics');

      // Attempt to extract workspaceId from userId prefix (WS#workspaceId#...)
      let workspaceId: string | undefined;
      if (userId.startsWith('WS#')) {
        const parts = userId.split('#');
        workspaceId = parts[1];
      }

      await emitMetrics([
        METRICS.storageError('deleteItem', errorName, tableName, { workspaceId }),
      ]).catch(() => {});
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw error;
      }
      logger.error('Error deleting item from DynamoDB:', error);
      throw error;
    }
  }

  /**
   * Internal helper for Update commands.
   *
   * @param params - The DynamoDB UpdateCommand parameters.
   * @returns A promise resolving to the update result.
   */
  public async updateItem(
    params: Record<string, unknown>
  ): Promise<import('@aws-sdk/lib-dynamodb').UpdateCommandOutput | undefined> {
    const tableName = this.tableName;
    if (!tableName) return undefined;

    const command = new UpdateCommand({
      TableName: tableName,
      ...params,
    } as import('@aws-sdk/lib-dynamodb').UpdateCommandInput);
    try {
      return await this.docClient.send(command);
    } catch (error) {
      const errorName = (error as Error).name || 'UnknownError';
      const { emitMetrics, METRICS } = await import('../metrics/metrics');
      const workspaceId = (command.input.ExpressionAttributeValues as any)?.[':workspaceId'];
      await emitMetrics([
        METRICS.storageError('updateItem', errorName, tableName, { workspaceId }),
      ]).catch(() => {});
      throw error;
    }
  }

  /**
   * Internal helper for Scan commands with a prefix filter on the Hash Key (userId).
   * Note: This is an expensive Scan operation, used ONLY for system health sampling.
   * @internal
   */
  public async scanByPrefix(
    prefix: string,
    options?: { limit?: number }
  ): Promise<Record<string, unknown>[]> {
    const tableName = this.tableName;
    if (!tableName) return [];

    const items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;
    const limit = options?.limit;

    try {
      do {
        const scanCommand = new ScanCommand({
          TableName: tableName,
          FilterExpression: 'begins_with(userId, :prefix)',
          ExpressionAttributeValues: {
            ':prefix': prefix,
          },
          ExclusiveStartKey: lastEvaluatedKey,
          Limit: limit,
        } as import('@aws-sdk/lib-dynamodb').ScanCommandInput);

        const scanResponse = (await this.docClient.send(
          scanCommand
        )) as import('@aws-sdk/lib-dynamodb').ScanCommandOutput;
        if (scanResponse.Items && scanResponse.Items.length > 0) {
          items.push(...(scanResponse.Items as Record<string, unknown>[]));
        }

        if (limit && items.length >= limit) break;
        lastEvaluatedKey = scanResponse.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      return items;
    } catch (error) {
      logger.error('Error scanning DynamoDB by prefix:', error);
      throw error;
    }
  }

  /**
   * Universal fetcher for memory items by their prefix.
   * Note: This uses an expensive Scan operation. Use sparingly.
   */
  public async listByPrefix(prefix: string): Promise<Record<string, unknown>[]> {
    return this.scanByPrefix(prefix);
  }

  /**
   * Standard implementation for getHistory.
   * Filters out expired items based on TTL.
   */
  public async getHistory(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    const { getHistory } = await import('./base-operations');
    return getHistory(this, userId, scope);
  }

  /**
   * Standard implementation for clearHistory.
   */
  public async clearHistory(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    const { clearHistory } = await import('./base-operations');
    return clearHistory(this, userId, scope);
  }

  /**
   * Standard implementation for getDistilledMemory.
   */
  public async getDistilledMemory(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    const { getDistilledMemory } = await import('./base-operations');
    return getDistilledMemory(this, userId, scope);
  }

  /**
   * Standard implementation for listConversations.
   */
  public async listConversations(
    userId: string,
    scope?: string | import('../types/memory').ContextualScope
  ) {
    const { listConversations } = await import('./base-operations');
    return listConversations(this, userId, scope);
  }
}
