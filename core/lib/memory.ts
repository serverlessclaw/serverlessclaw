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
  GapStatus,
  ConversationMeta,
} from './types/index';
import { logger } from './logger';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const typedResource = Resource as unknown as SSTResource;

/**
 * Implementation of IMemory using AWS DynamoDB for persistent storage
 * of session history, distilled knowledge, and strategic insights.
 */
export class DynamoMemory implements IMemory {
  /**
   * Resolves table name lazily to handle unit testing environments safely.
   */
  private get tableName(): string {
    return typedResource?.MemoryTable?.name || 'MemoryTable';
  }

  /**
   * Helper to get retention days lazily to avoid circular dependencies
   */
  private async getRetention(
    item: 'MESSAGES_DAYS' | 'LESSONS_DAYS' | 'SESSIONS_DAYS'
  ): Promise<number> {
    const { AgentRegistry } = await import('./registry');
    return AgentRegistry.getRetentionDays(item);
  }

  /**
   * Retrieves the conversation history for a specific user or session
   * @param userId - Unique identifier for the user or session
   * @returns Array of messages sorted by timestamp (oldest first)
   */
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
        agentName: item.agentName,
        traceId: item.traceId,
      }));
    } catch (error) {
      logger.error('Error retrieving history from DynamoDB:', error);
      return [];
    }
  }

  /**
   * Appends a new message to the conversation history
   * @param userId - Unique identifier for the user or session
   * @param message - The message object to be stored
   */
  async addMessage(userId: string, message: Message): Promise<void> {
    console.log(`[DynamoMemory] Adding message for userId: ${userId}`);
    const days = await this.getRetention('MESSAGES_DAYS');
    const expiresAt = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        userId,
        timestamp: Date.now(),
        expiresAt,
        ...message,
      },
    });

    try {
      await docClient.send(command);
    } catch (error) {
      logger.error('Error saving message to DynamoDB:', error);
    }
  }

  /**
   * Clears the conversation history for a specific user or session
   */
  async clearHistory(userId: string): Promise<void> {
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');

    // Query to get all items (with their sort keys)
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
    });

    try {
      const response = await docClient.send(command);
      const items = response.Items || [];

      for (const item of items) {
        await docClient.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: {
              userId: item.userId,
              timestamp: item.timestamp,
            },
          })
        );
      }
      logger.info(`Cleared history for ${userId} (${items.length} items)`);
    } catch (error) {
      logger.error('Error clearing history from DynamoDB:', error);
    }
  }

  /**
   * Deletes a conversation session and its history
   */
  async deleteConversation(userId: string, sessionId: string): Promise<void> {
    const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');

    // 1. Delete session metadata from SESSIONS#userId
    const conversations = await this.listConversations(userId);
    const existing = conversations.find((c) => c.sessionId === sessionId);

    if (existing) {
      try {
        await docClient.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: {
              userId: `SESSIONS#${userId}`,
              timestamp: existing.updatedAt,
            },
          })
        );
        console.log(`[DynamoMemory] Deleted session meta for ${sessionId}`);
      } catch (error) {
        logger.error(`Error deleting session meta for ${sessionId}:`, error);
      }
    }

    // 2. Delete all history messages from CONV#userId#sessionId
    await this.clearHistory(`CONV#${userId}#${sessionId}`);
  }

  /**
   * Retrieves distilled facts and lessons for a specific user
   * @param userId - Unique identifier for the user
   * @returns String containing concatenated facts and lessons
   */
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

  /**
   * Updates the distilled memory (facts and lessons) for a user
   * @param userId - Unique identifier for the user
   * @param facts - The new textual content for the distilled memory
   */
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

  /**
   * Retrieves all capability gaps filtered by status
   * @param status - The current status of the gaps to retrieve (defaults to OPEN)
   * @returns Array of MemoryInsight objects representing the gaps
   */
  async getAllGaps(status: GapStatus = GapStatus.OPEN): Promise<MemoryInsight[]> {
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

  /**
   * Records or updates a capability gap identified by the system
   * @param gapId - Unique ID for the gap
   * @param details - Description of the gap
   * @param metadata - Strategic metadata (impact, complexity, etc.)
   */
  async setGap(gapId: string, details: string, metadata?: InsightMetadata): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        userId: `GAP#${gapId}`,
        timestamp: parseInt(gapId, 10) || Date.now(),
        content: details,
        status: GapStatus.OPEN,
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

  /**
   * Transitions a capability gap to a new status
   * @param gapId - The ID of the gap to update
   * @param status - The new GapStatus
   */
  async updateGapStatus(gapId: string, status: GapStatus): Promise<void> {
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
      const statuses = Object.values(GapStatus);
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

  /**
   * Adds a tactical lesson learned from recent agent operations
   * @param userId - Unique identifier for the user
   * @param lesson - Textual content of the lesson
   * @param metadata - Insight metadata
   */
  async addLesson(userId: string, lesson: string, metadata?: InsightMetadata): Promise<void> {
    const days = await this.getRetention('LESSONS_DAYS');
    const expiresAt = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        userId: `LESSON#${userId}`,
        timestamp: Date.now(),
        expiresAt,
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

  /**
   * Retrieves the most recent tactical lessons for a user
   * @param userId - Unique identifier for the user
   * @returns Array of textual lessons
   */
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

  /**
   * Searches for insights across all categories based on a query string
   * @param userId - Unique identifier for the user
   * @param query - Keyword query string or '*' for all
   * @param category - Optional category filter
   * @returns Array of MemoryInsight objects
   */
  /**
   * Searches for insights across all categories based on a query string
   * @param userId - Unique identifier for the user
   * @param query - Keyword query string or '*' for all
   * @param category - Optional category filter
   * @returns Array of MemoryInsight objects
   */
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
          id: item.userId as string,
          content: item.content as string,
          metadata: (item.metadata as InsightMetadata) || {
            category: InsightCategory.SYSTEM_KNOWLEDGE,
            confidence: 0,
            impact: 0,
            complexity: 0,
            risk: 0,
            urgency: 0,
            priority: 0,
          },
          timestamp: item.timestamp as number,
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

  /**
   * Updates the metadata for a specific insight item
   * @param userId - Unique identifier for the user or insight prefix
   * @param timestamp - The timestamp (sort key) of the item
   * @param metadata - Partial metadata object to merge
   */
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

  /**
   * Lists all sessions for a user by querying the SESSIONS# index
   */
  async listConversations(userId: string): Promise<ConversationMeta[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': `SESSIONS#${userId}`,
      },
      ScanIndexForward: false, // Newest first
    });

    try {
      const response = await docClient.send(command);
      return (response.Items || []).map((item) => ({
        sessionId: item.sessionId,
        title: item.title,
        lastMessage: item.content, // We store last message in content
        updatedAt: item.timestamp,
      }));
    } catch (error) {
      logger.error('Error listing conversations from DynamoDB:', error);
      return [];
    }
  }

  /**
   * Saves or updates session metadata
   */
  async saveConversationMeta(
    userId: string,
    sessionId: string,
    meta: Partial<ConversationMeta>
  ): Promise<void> {
    // First, try to find existing record for this session to avoid duplicates
    const conversations = await this.listConversations(userId);
    const existing = conversations.find((c) => c.sessionId === sessionId);

    // If update, we delete the old one first because timestamp (sort key) might change
    if (existing) {
      const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
      await docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            userId: `SESSIONS#${userId}`,
            timestamp: existing.updatedAt,
          },
        })
      );
    }

    const days = await this.getRetention('SESSIONS_DAYS');
    const expiresAt = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        userId: `SESSIONS#${userId}`,
        timestamp: Date.now(),
        expiresAt,
        sessionId,
        title: meta.title || existing?.title || 'New Conversation',
        content: meta.lastMessage || existing?.lastMessage || '',
      },
    });

    console.log(
      `[DynamoMemory] Saving session meta for ${sessionId} under userId: SESSIONS#${userId}`
    );
    try {
      await docClient.send(command);
      console.log(`[DynamoMemory] Successfully saved session meta for ${sessionId}`);
    } catch (error) {
      logger.error('Error saving conversation meta to DynamoDB:', error);
    }
  }
}
