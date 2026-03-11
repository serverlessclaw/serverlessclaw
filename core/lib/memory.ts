import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from './types/index';
import {
  IMemory,
  Message,
  MessageRole,
  InsightMetadata,
  MemoryInsight,
  InsightCategory,
} from './types/index';
import { logger } from './logger';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const typedResource = Resource as unknown as SSTResource;

export class DynamoMemory implements IMemory {
  private tableName = typedResource.MemoryTable.name;

  async getHistory(userId: string): Promise<Message[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      ScanIndexForward: true, // Oldest first
    });

    try {
      const response = await docClient.send(command);
      return (response.Items || []).map((item) => ({
        role: item.role as MessageRole,
        content: item.content,
        tool_calls: item.tool_calls,
        tool_call_id: item.tool_call_id,
        name: item.name,
      }));
    } catch (error) {
      logger.error('Error retrieving history from DynamoDB:', error);
      return [];
    }
  }

  async addMessage(userId: string, message: Message) {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        userId,
        timestamp: Date.now(),
        ...message,
      },
    });

    try {
      await docClient.send(command);
    } catch (error) {
      logger.error('Error saving message to DynamoDB:', error);
    }
  }

  async clearHistory(userId: string) {
    logger.info('Clear history requested for', userId);
  }

  async getDistilledMemory(userId: string): Promise<string> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': `DISTILLED#${userId}`,
      },
    });

    try {
      const response = await docClient.send(command);
      return response.Items?.[0]?.content || '';
    } catch (error) {
      logger.error('Error retrieving distilled memory from DynamoDB:', error);
      return '';
    }
  }

  async updateDistilledMemory(userId: string, facts: string): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        userId: `DISTILLED#${userId}`,
        timestamp: Date.now(),
        content: facts,
      },
    });

    try {
      await docClient.send(command);
    } catch (error) {
      logger.error('Error updating distilled memory in DynamoDB:', error);
    }
  }

  async getAllGaps(
    status: 'OPEN' | 'PLANNED' | 'PROGRESS' | 'DEPLOYED' | 'DONE' | 'FAILED' | 'ARCHIVED' = 'OPEN'
  ): Promise<MemoryInsight[]> {
    // In a real system, we would have a GSI for Category=GAP
    // For now, we query with the GAP# prefix using a Scan
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'begins_with(userId, :prefix) AND #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':prefix': 'GAP#',
        ':status': status,
      },
    });

    try {
      const response = await docClient.send(command);
      return (response.Items || []).map((item) => ({
        id: item.userId,
        content: item.content,
        timestamp: item.timestamp,
        metadata: item.metadata || {
          category: InsightCategory.STRATEGIC_GAP,
          confidence: 0,
          impact: 0,
          complexity: 0,
          risk: 0,
          urgency: 0,
          priority: 0,
        },
      }));
    } catch (error) {
      logger.error(`Error scanning ${status} gaps from DynamoDB:`, error);
      return [];
    }
  }

  async setGap(gapId: string, details: string, metadata?: InsightMetadata): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        userId: `GAP#${gapId}`,
        timestamp: parseInt(gapId, 10) || Date.now(),
        content: details,
        status: 'OPEN',
        metadata: metadata || {
          category: InsightCategory.STRATEGIC_GAP,
          confidence: 5,
          impact: 5,
          complexity: 5,
          risk: 5,
          urgency: 5,
          priority: 5,
        },
      },
    });

    try {
      await docClient.send(command);
    } catch (error) {
      logger.error('Error setting capablity gap in DynamoDB:', error);
    }
  }

  async updateGapStatus(
    gapId: string,
    status: 'OPEN' | 'PLANNED' | 'PROGRESS' | 'DEPLOYED' | 'DONE' | 'FAILED' | 'ARCHIVED'
  ): Promise<void> {
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const numericId = gapId.replace('GAP#', '');
    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        userId: `GAP#${numericId}`,
        timestamp: parseInt(numericId, 10) || 0,
      },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
      },
    });

    // Try to find the exact item if timestamp is not in gapId or if 0 doesn't work
    if (isNaN(parseInt(numericId, 10)) || command.input.Key?.timestamp === 0) {
      const statuses: Array<'OPEN' | 'PLANNED' | 'PROGRESS' | 'DEPLOYED' | 'DONE' | 'FAILED' | 'ARCHIVED'> = [
        'OPEN',
        'PLANNED',
        'PROGRESS',
        'DEPLOYED',
        'DONE',
        'FAILED',
        'ARCHIVED',
      ];
      for (const s of statuses) {
        const gaps = await this.getAllGaps(s);
        const target = gaps.find((g) => g.id === `GAP#${numericId}`);
        if (target) {
          command.input.Key = { userId: `GAP#${numericId}`, timestamp: target.timestamp };
          break;
        }
      }
    }

    try {
      await docClient.send(command);
      logger.info(`Gap ${gapId} status updated to ${status}`);
    } catch (error) {
      logger.error(`Error updating gap ${gapId} status to ${status}:`, error);
    }
  }

  async addLesson(userId: string, lesson: string, metadata?: InsightMetadata): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        userId: `LESSON#${userId}`,
        timestamp: Date.now(),
        content: lesson,
        metadata: metadata || {
          category: InsightCategory.TACTICAL_LESSON,
          confidence: 5,
          impact: 5,
          complexity: 5,
          risk: 5,
          urgency: 5,
          priority: 5,
        },
      },
    });

    try {
      await docClient.send(command);
    } catch (error) {
      logger.error('Error saving lesson to DynamoDB:', error);
    }
  }

  async getLessons(userId: string): Promise<string[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': `LESSON#${userId}`,
      },
      Limit: 10,
      ScanIndexForward: false, // Newest first
    });

    try {
      const response = await docClient.send(command);
      return (response.Items || []).map((item) => item.content);
    } catch (error) {
      logger.error('Error retrieving lessons from DynamoDB:', error);
      return [];
    }
  }

  async searchInsights(
    userId: string,
    query: string,
    category?: InsightCategory
  ): Promise<MemoryInsight[]> {
    // For now, we perform a simple query to get recent insights for the user.
    // In a real high-volume system, we would use a Global Secondary Index or full-text search.
    const prefixes = [`LESSON#${userId}`, `GAP#`, `DISTILLED#${userId}`];
    let allInsights: MemoryInsight[] = [];

    for (const prefix of prefixes) {
      const command = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': prefix,
        },
        Limit: 50,
      });

      try {
        const response = await docClient.send(command);
        const insights = (response.Items || []).map((item) => ({
          id: item.userId,
          content: item.content,
          metadata: item.metadata || {
            category: InsightCategory.SYSTEM_KNOWLEDGE,
            confidence: 0,
            impact: 0,
            complexity: 0,
            risk: 0,
            urgency: 0,
            priority: 0,
          },
          timestamp: item.timestamp,
        }));
        allInsights = [...allInsights, ...insights];
      } catch (e) {
        logger.error(`Error searching insights for ${prefix}:`, e);
      }
    }

    // Filter by category if provided
    if (category) {
      allInsights = allInsights.filter((i) => i.metadata.category === category);
    }

    // Simple keyword filtering based on the query
    if (query && query !== '*' && query !== '') {
      const lowerQuery = query.toLowerCase();
      allInsights = allInsights.filter((i) => i.content.toLowerCase().includes(lowerQuery));
    }

    return allInsights.sort((a, b) => b.timestamp - a.timestamp);
  }

  async updateInsightMetadata(
    userId: string,
    timestamp: number,
    metadata: Partial<InsightMetadata>
  ): Promise<void> {
    // First, fetch the existing item to merge metadata
    const getCommand = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'userId = :userId AND #ts = :timestamp',
      ExpressionAttributeNames: {
        '#ts': 'timestamp',
      },
      ExpressionAttributeValues: {
        ':userId': userId,
        ':timestamp': timestamp,
      },
    });

    try {
      const response = await docClient.send(getCommand);
      const item = response.Items?.[0];

      if (!item) {
        logger.error('Item not found for update:', userId, timestamp);
        return;
      }

      const updatedMetadata = {
        ...(item.metadata || {}),
        ...metadata,
      };

      const putCommand = new PutCommand({
        TableName: this.tableName,
        Item: {
          ...item,
          metadata: updatedMetadata,
        },
      });

      await docClient.send(putCommand);
    } catch (error) {
      logger.error('Error updating insight metadata in DynamoDB:', error);
    }
  }
}
