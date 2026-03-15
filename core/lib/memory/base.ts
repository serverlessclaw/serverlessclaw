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
import { SSTResource, Message, MessageRole, ConversationMeta } from '../types/index';

const client = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const typedResource = Resource as unknown as SSTResource;

/**
 * Base logic for DynamoDB interactions within the memory system.
 */
export class BaseMemoryProvider {
  /**
   * Resolves table name lazily.
   */
  protected get tableName(): string {
    return typedResource?.MemoryTable?.name || 'MemoryTable';
  }

  /**
   * Internal helper to put an item into DynamoDB
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async putItem(item: any): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: item,
    });
    try {
      await docClient.send(command);
    } catch (error) {
      logger.error('Error putting item into DynamoDB:', error);
    }
  }

  /**
   * Internal helper for Query commands
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async queryItems(params: any): Promise<any[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      ...params,
    });
    try {
      const response = await docClient.send(command);
      return response.Items || [];
    } catch (error) {
      logger.error('Error querying DynamoDB:', error);
      return [];
    }
  }

  /**
   * Internal helper for Delete commands
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async deleteItem(key: Record<string, any>): Promise<void> {
    try {
      await docClient.send(
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
   * Internal helper for Update commands
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async updateItem(params: any): Promise<any> {
    const command = new UpdateCommand({
      TableName: this.tableName,
      ...params,
    });
    return docClient.send(command);
  }

  /**
   * Standard implementation for getHistory
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
   * Standard implementation for clearHistory
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
   * Standard implementation for getDistilledMemory
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

    return items?.[0]?.content || '';
  }

  /**
   * Standard implementation for listConversations
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
    }));
  }
}
