import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import {
  IMemory,
  Message,
  MessageRole,
  InsightMetadata,
  MemoryInsight,
  InsightCategory,
} from './types/index.js';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export class DynamoMemory implements IMemory {
  private tableName = Resource.MemoryTable.name;

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
      console.error('Error retrieving history from DynamoDB:', error);
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
      console.error('Error saving message to DynamoDB:', error);
    }
  }

  async clearHistory(userId: string) {
    console.log('Clear history requested for', userId);
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
      console.error('Error retrieving distilled memory from DynamoDB:', error);
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
      console.error('Error updating distilled memory in DynamoDB:', error);
    }
  }

  async setGap(gapId: string, details: string, metadata?: InsightMetadata): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        userId: `GAP#${gapId}`,
        timestamp: Date.now(),
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
      console.error('Error setting capablity gap in DynamoDB:', error);
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
      console.error('Error saving lesson to DynamoDB:', error);
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
      console.error('Error retrieving lessons from DynamoDB:', error);
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
        console.error(`Error searching insights for ${prefix}:`, e);
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
}
