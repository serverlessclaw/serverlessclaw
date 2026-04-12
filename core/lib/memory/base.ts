import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
  ScanCommand,
  BatchWriteCommand,
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
      Item: {
        ...item,
        attachments: (item.attachments as unknown[]) ?? [],
        tool_calls: (item.tool_calls as unknown[]) ?? [],
      },
    });
    try {
      await this.docClient.send(command);
    } catch (error) {
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
    const command = new QueryCommand({
      TableName: this.tableName,
      ...params,
    });
    try {
      const response = await this.docClient.send(command);
      return {
        items: (response.Items as Record<string, unknown>[]) ?? [],
        lastEvaluatedKey: response.LastEvaluatedKey,
      };
    } catch (error) {
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
  ): Promise<import('@aws-sdk/lib-dynamodb').UpdateCommandOutput> {
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
   * @param options - Optional scan parameters like limit.
   * @returns A promise resolving to an array of items.
   */
  public async scanByPrefix(
    prefix: string,
    options?: { limit?: number }
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;
    const limit = options?.limit;

    try {
      do {
        const scanCommand = new ScanCommand({
          TableName: this.tableName,
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
   * Standard implementation for getHistory.
   * Filters out expired items based on TTL.
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

    const now = Math.floor(Date.now() / 1000); // Current time in seconds for TTL comparison
    const validItems = (items || []).filter(
      (item) => !item.expiresAt || (item.expiresAt as number) > now
    );

    return validItems.map((item) => ({
      role: item.role as MessageRole,
      content: (item.content as string) ?? '',
      thought: item.thought as string | undefined,
      tool_calls: (item.tool_calls as import('./../types/llm').ToolCall[] | undefined) ?? [],
      attachments: (item.attachments as import('./../types/agent').Attachment[] | undefined) ?? [],
      tool_call_id: item.tool_call_id as string | undefined,
      name: item.name as string | undefined,
      agentName: item.agentName as string | undefined,
      traceId: (item.traceId as string) || `legacy-${item.timestamp || Date.now()}`,
      messageId: (item.messageId as string) || `msg-legacy-${item.timestamp || Date.now()}`,
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

    if (items.length === 0) return;

    // Batch delete in groups of 25 (DynamoDB limit)
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      let requestItems = {
        [this.tableName]: batch.map((item) => ({
          DeleteRequest: {
            Key: { userId: item.userId as string, timestamp: item.timestamp as number },
          },
        })),
      };

      // Retry loop for unprocessed items (throughput throttling)
      let attempts = 0;
      const MAX_ATTEMPTS = 5;

      while (Object.keys(requestItems).length > 0 && attempts < MAX_ATTEMPTS) {
        if (attempts > 0) {
          const delay = Math.pow(2, attempts) * 100 + Math.random() * 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const response = await this.docClient.send(
          new BatchWriteCommand({ RequestItems: requestItems })
        );
        requestItems = (response.UnprocessedItems as typeof requestItems) ?? {};
        attempts++;
      }

      if (Object.keys(requestItems).length > 0) {
        logger.error(`Failed to clear all history for ${userId} after ${MAX_ATTEMPTS} attempts.`, {
          unprocessedCount: Object.keys(requestItems[this.tableName] || {}).length,
        });
      }
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
      updatedAt: item.timestamp as number | string,
      isPinned: !!item.isPinned,
      expiresAt: item.expiresAt as number | undefined,
    }));
  }
}
