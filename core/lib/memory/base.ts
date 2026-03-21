import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async putItem(item: any): Promise<void> {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async queryItemsPaginated(params: any): Promise<{ items: any[]; lastEvaluatedKey?: any }> {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async queryItems(params: any): Promise<any[]> {
    const { items } = await this.queryItemsPaginated(params);
    return items;
  }

  /**
   * Internal helper for Delete commands.
   *
   * @param key - The primary key of the item to delete.
   * @returns A promise resolving when the operation is complete.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async deleteItem(key: Record<string, any>): Promise<void> {
    try {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: key,
        })
      );
    } catch (error) {
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
  public async updateItem(params: any): Promise<any> {
    const command = new UpdateCommand({
      TableName: this.tableName,
      ...params,
    });
    return this.docClient.send(command);
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
      content: item.content,
      tool_calls: item.tool_calls,
      tool_call_id: item.tool_call_id,
      name: item.name,
      agentName: item.agentName,
      traceId: item.traceId,
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
        userId: item.userId,
        timestamp: item.timestamp,
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

    return items?.[0]?.content ?? '';
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
      sessionId: item.sessionId,
      title: item.title,
      lastMessage: item.content,
      updatedAt: item.timestamp,
      isPinned: !!item.isPinned,
      expiresAt: item.expiresAt,
    }));
  }
}
