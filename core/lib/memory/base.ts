import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

import { Resource } from 'sst';
import { logger } from '../logger';
import { SSTResource } from '../types/system';
import { Message, MessageRole } from '../types/llm';
import { ConversationMeta } from '../types/memory';

// Default client for backward compatibility - can be overridden via constructor for testing
const defaultClient = new DynamoDBClient({});
const defaultDocClient = DynamoDBDocumentClient.from(defaultClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const typedResource = Resource as unknown as SSTResource;

/**
 * Base logic for DynamoDB interactions within the memory system.
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
   * Resolves table name lazily.
   *
   * @returns The resolved table name string.
   */
  protected get tableName(): string {
    return typedResource?.MemoryTable?.name ?? 'MemoryTable';
  }

  /**
   * Internal helper to put an item into DynamoDB.
   *
   * @param item - The item object to store.
   * @returns A promise resolving when the operation is complete.
   */
  public async putItem(item: Record<string, unknown>): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: item,
    });
    try {
      await this.docClient.send(command);
    } catch (error) {
      logger.error('Error putting item into DynamoDB:', error);
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
    const command = new QueryCommand({
      TableName: this.tableName,
      ...params,
    });
    try {
      const response = await this.docClient.send(command);
      return {
        items: response.Items ?? [],
        lastEvaluatedKey: response.LastEvaluatedKey,
      };
    } catch (error) {
      logger.error('Error querying DynamoDB:', error);
      return { items: [] };
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
      timestamp: number;
    } & Partial<
      Pick<
        import('@aws-sdk/lib-dynamodb').DeleteCommandInput,
        'ConditionExpression' | 'ExpressionAttributeNames' | 'ExpressionAttributeValues'
      >
    >
  ): Promise<void> {
    const { userId, timestamp, ...conditions } = params;
    try {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { userId, timestamp },
          ...conditions,
        })
      );
    } catch (error) {
      // Re-throw conditional check failures so callers can handle them
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw error;
      }
      logger.error('Error deleting item from DynamoDB:', error);
    }
  }

  /**
   * Internal helper for Update commands.
   *
   * @param params - The DynamoDB UpdateCommand parameters.
   * @returns A promise resolving to the update result.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async updateItem(params: Record<string, any>): Promise<any> {
    const command = new UpdateCommand({
      TableName: this.tableName,
      ...params,
    } as import('@aws-sdk/lib-dynamodb').UpdateCommandInput);
    return this.docClient.send(command);
  }

  /**
   * Internal helper for Scan commands with a prefix filter on the Hash Key (userId).
   * Note: This is a Scan operation, use sparingly on large tables.
   *
   * @param prefix - The prefix to search for in the userId field.
   * @returns A promise resolving to an array of items.
   */
  public async scanByPrefix(prefix: string): Promise<Record<string, unknown>[]> {
    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'begins_with(userId, :prefix)',
      ExpressionAttributeValues: {
        ':prefix': prefix,
      },
    });
    try {
      const response = await this.docClient.send(command);
      return response.Items ?? [];
    } catch (error) {
      logger.error('Error scanning DynamoDB by prefix:', error);
      return [];
    }
  }

  /**
   * Standard implementation for getHistory.
   *
   * @param userId - The user identifier to retrieve history for.
   * @returns A promise resolving to an array of Message objects.
   */
  async getHistory(userId: string): Promise<Message[]> {
    const items = await this.queryItems({
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      ScanIndexForward: true, // Oldest first
    });

    return items.map((item) => ({
      role: item.role as MessageRole,
      content: item.content as string | undefined,
      thought: item.thought as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tool_calls: item.tool_calls as any,
      tool_call_id: item.tool_call_id as string | undefined,
      name: item.name as string | undefined,
      agentName: item.agentName as string | undefined,
      traceId: item.traceId as string | undefined,
    }));
  }

  /**
   * Standard implementation for clearHistory.
   *
   * @param userId - The user identifier to clear history for.
   * @returns A promise resolving when history is cleared.
   */
  async clearHistory(userId: string): Promise<void> {
    const items = await this.queryItems({
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
    });

    for (const item of items) {
      await this.deleteItem({
        userId: item.userId as string,
        timestamp: item.timestamp as number,
      });
    }
    logger.info(`Cleared history for ${userId} (${items.length} items)`);
  }

  /**
   * Standard implementation for getDistilledMemory.
   *
   * @param userId - The user identifier to retrieve distilled memory for.
   * @returns A promise resolving to the distilled memory string.
   */
  async getDistilledMemory(userId: string): Promise<string> {
    const items = await this.queryItems({
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': `DISTILLED#${userId}`,
      },
      ScanIndexForward: false, // Latest first
      Limit: 1,
    });

    return (items?.[0]?.content as string) ?? '';
  }

  /**
   * Standard implementation for listConversations.
   *
   * @param userId - The user identifier to list conversations for.
   * @returns A promise resolving to an array of ConversationMeta objects.
   */
  async listConversations(userId: string): Promise<ConversationMeta[]> {
    const items = await this.queryItems({
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': `SESSIONS#${userId}`,
      },
      ScanIndexForward: false, // Newest first
    });

    return items.map((item) => ({
      sessionId: item.sessionId as string,
      title: item.title as string,
      lastMessage: item.content as string,
      updatedAt: item.timestamp as number,
      isPinned: !!item.isPinned,
      expiresAt: item.expiresAt as number | undefined,
    }));
  }
}
