import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { SSTResource } from './types/system';
import { logger } from './logger';

const SESSION_PREFIX = 'SESSION_STATE#';
const LOCK_TTL_SECONDS = 300; // 5 minutes for lock timeout (crash recovery)
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days for DynamoDB TTL
const TIME = { MS_PER_SECOND: 1000 };

// Default client for backward compatibility - can be overridden via constructor for testing
const defaultClient = new DynamoDBClient({});
const defaultDocClient = DynamoDBDocumentClient.from(defaultClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const typedResource = Resource as unknown as SSTResource;

export interface PendingMessage {
  id: string;
  content: string;
  attachments?: Array<{
    type: 'image' | 'file';
    url?: string;
    base64?: string;
    name?: string;
    mimeType?: string;
  }>;
  timestamp: number;
}

export interface SessionState {
  sessionId: string;
  processingAgentId: string | null;
  processingStartedAt: number | null;
  pendingMessages: PendingMessage[];
  lastMessageAt: number;
}

export class SessionStateManager {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(docClient?: DynamoDBDocumentClient) {
    this.docClient = docClient ?? defaultDocClient;
    this.tableName = typedResource.MemoryTable.name;
  }

  private getKey(sessionId: string): string {
    return `${SESSION_PREFIX}${sessionId}`;
  }

  private getLockExpiresAt(): number {
    return Math.floor(Date.now() / TIME.MS_PER_SECOND) + LOCK_TTL_SECONDS;
  }

  private getSessionExpiresAt(): number {
    return Math.floor(Date.now() / TIME.MS_PER_SECOND) + SESSION_TTL_SECONDS;
  }

  /**
   * Attempts to acquire the processing flag for a session.
   * Uses conditional write to prevent race conditions.
   */
  async acquireProcessing(sessionId: string, agentId: string): Promise<boolean> {
    const key = this.getKey(sessionId);
    const now = Date.now();
    const lockExpiresAt = this.getLockExpiresAt();
    const expiresAt = this.getSessionExpiresAt();

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            userId: key,
            timestamp: 0,
            sessionId,
            processingAgentId: agentId,
            processingStartedAt: now,
            pendingMessages: [],
            lastMessageAt: now,
            lockExpiresAt,
            expiresAt,
          },
          ConditionExpression:
            'attribute_not_exists(processingAgentId) OR processingAgentId = :null OR lockExpiresAt < :now',
          ExpressionAttributeValues: {
            ':null': null,
            ':now': Math.floor(Date.now() / TIME.MS_PER_SECOND),
          },
        })
      );
      logger.info(`Session ${sessionId}: Processing flag acquired by ${agentId}`);
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        logger.info(`Session ${sessionId}: Already being processed by another agent`);
        return false;
      }
      logger.error(`Session ${sessionId}: Failed to acquire processing flag:`, error);
      throw error;
    }
  }

  /**
   * Releases the processing flag for a session.
   */
  async releaseProcessing(sessionId: string): Promise<void> {
    const key = this.getKey(sessionId);

    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: key,
            timestamp: 0,
          },
          UpdateExpression:
            'SET processingAgentId = :null, processingStartedAt = :null, lockExpiresAt = :null, expiresAt = :exp',
          ExpressionAttributeValues: {
            ':null': null,
            ':exp': this.getSessionExpiresAt(),
          },
        })
      );
      logger.info(`Session ${sessionId}: Processing flag released`);
    } catch (error) {
      logger.error(`Session ${sessionId}: Failed to release processing flag:`, error);
    }
  }

  /**
   * Renews the processing flag TTL. Called periodically during long-running tasks.
   */
  async renewProcessing(sessionId: string, agentId: string): Promise<boolean> {
    const key = this.getKey(sessionId);
    const lockExpiresAt = this.getLockExpiresAt();
    const expiresAt = this.getSessionExpiresAt();

    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: key,
            timestamp: 0,
          },
          UpdateExpression: 'SET lockExpiresAt = :lockExp, expiresAt = :exp',
          ConditionExpression: 'processingAgentId = :agentId',
          ExpressionAttributeValues: {
            ':lockExp': lockExpiresAt,
            ':exp': expiresAt,
            ':agentId': agentId,
          },
        })
      );
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        logger.warn(`Session ${sessionId}: Lock expired or owned by another agent`);
        return false;
      }
      logger.error(`Session ${sessionId}: Failed to renew processing flag:`, error);
      return false;
    }
  }

  /**
   * Adds a message to the pending queue.
   */
  async addPendingMessage(
    sessionId: string,
    content: string,
    attachments?: PendingMessage['attachments']
  ): Promise<void> {
    const key = this.getKey(sessionId);
    const now = Date.now();
    const messageId = `pending_${now}_${Math.random().toString(36).substring(7)}`;

    const pendingMessage: PendingMessage = {
      id: messageId,
      content,
      attachments,
      timestamp: now,
    };

    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: key,
            timestamp: 0,
          },
          UpdateExpression:
            'SET pendingMessages = list_append(if_not_exists(pendingMessages, :empty), :msg), lastMessageAt = :now, expiresAt = :exp',
          ExpressionAttributeValues: {
            ':empty': [],
            ':msg': [pendingMessage],
            ':now': now,
            ':exp': this.getSessionExpiresAt(),
          },
        })
      );
      logger.info(`Session ${sessionId}: Added pending message ${messageId}`);
    } catch (error) {
      logger.error(`Session ${sessionId}: Failed to add pending message:`, error);
      throw error;
    }
  }

  /**
   * Retrieves all pending messages for a session.
   */
  async getPendingMessages(sessionId: string): Promise<PendingMessage[]> {
    const key = this.getKey(sessionId);

    try {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            userId: key,
            timestamp: 0,
          },
          ConsistentRead: true,
        })
      );

      if (!result.Item) {
        return [];
      }

      return (result.Item.pendingMessages as PendingMessage[]) || [];
    } catch (error) {
      logger.error(`Session ${sessionId}: Failed to get pending messages:`, error);
      return [];
    }
  }

  /**
   * Clears specific pending messages for a session to avoid race conditions.
   */
  async clearPendingMessages(sessionId: string, messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;

    const key = this.getKey(sessionId);

    try {
      const currentMessages = await this.getPendingMessages(sessionId);
      const remainingMessages = currentMessages.filter((m) => !messageIds.includes(m.id));

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: key,
            timestamp: 0,
          },
          UpdateExpression: 'SET pendingMessages = :remaining, expiresAt = :exp',
          ConditionExpression: 'pendingMessages = :current',
          ExpressionAttributeValues: {
            ':remaining': remainingMessages,
            ':current': currentMessages,
            ':exp': this.getSessionExpiresAt(),
          },
        })
      );
      logger.info(`Session ${sessionId}: Cleared ${messageIds.length} processed messages`);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        logger.warn(
          `Session ${sessionId}: Race condition detected while clearing pending messages, retrying...`
        );
        const freshMessages = await this.getPendingMessages(sessionId);
        const filtered = freshMessages.filter((m) => !messageIds.includes(m.id));
        await this.docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { userId: key, timestamp: 0 },
            UpdateExpression: 'SET pendingMessages = :remaining, expiresAt = :exp',
            ExpressionAttributeValues: {
              ':remaining': filtered,
              ':exp': this.getSessionExpiresAt(),
            },
          })
        );
      } else {
        logger.error(`Session ${sessionId}: Failed to clear pending messages:`, error);
      }
    }
  }

  /**
   * Removes a specific pending message by ID.
   */
  async removePendingMessage(sessionId: string, messageId: string): Promise<boolean> {
    const key = this.getKey(sessionId);

    try {
      const messages = await this.getPendingMessages(sessionId);
      const filtered = messages.filter((m) => m.id !== messageId);

      if (filtered.length === messages.length) {
        return false;
      }

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { userId: key, timestamp: 0 },
          UpdateExpression: 'SET pendingMessages = :filtered, expiresAt = :exp',
          ConditionExpression: 'pendingMessages = :original',
          ExpressionAttributeValues: {
            ':filtered': filtered,
            ':original': messages,
            ':exp': this.getSessionExpiresAt(),
          },
        })
      );
      return true;
    } catch (error) {
      logger.error(`Session ${sessionId}: Failed to remove pending message:`, error);
      return false;
    }
  }

  /**
   * Updates a specific pending message content.
   */
  async updatePendingMessage(
    sessionId: string,
    messageId: string,
    newContent: string
  ): Promise<boolean> {
    const key = this.getKey(sessionId);

    try {
      const messages = await this.getPendingMessages(sessionId);
      const updated = messages.map((m) =>
        m.id === messageId ? { ...m, content: newContent, timestamp: Date.now() } : m
      );

      if (JSON.stringify(messages) === JSON.stringify(updated)) {
        return false;
      }

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { userId: key, timestamp: 0 },
          UpdateExpression: 'SET pendingMessages = :updated, expiresAt = :exp',
          ConditionExpression: 'pendingMessages = :original',
          ExpressionAttributeValues: {
            ':updated': updated,
            ':original': messages,
            ':exp': this.getSessionExpiresAt(),
          },
        })
      );
      return true;
    } catch (error) {
      logger.error(`Session ${sessionId}: Failed to update pending message:`, error);
      return false;
    }
  }

  /**
   * Gets the current session state.
   */
  async getState(sessionId: string): Promise<SessionState | null> {
    const key = this.getKey(sessionId);

    try {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            userId: key,
            timestamp: 0,
          },
          ConsistentRead: true,
        })
      );

      if (!result.Item) {
        return null;
      }

      return {
        sessionId: result.Item.sessionId,
        processingAgentId: result.Item.processingAgentId,
        processingStartedAt: result.Item.processingStartedAt,
        pendingMessages: (result.Item.pendingMessages as PendingMessage[]) || [],
        lastMessageAt: result.Item.lastMessageAt,
      };
    } catch (error) {
      logger.error(`Session ${sessionId}: Failed to get session state:`, error);
      return null;
    }
  }

  /**
   * Checks if a session is currently being processed.
   */
  async isProcessing(sessionId: string): Promise<boolean> {
    const key = this.getKey(sessionId);
    try {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { userId: key, timestamp: 0 },
          ConsistentRead: true,
        })
      );

      if (!result.Item || !result.Item.processingAgentId) return false;

      const lockExpiresAt = result.Item.lockExpiresAt || 0;
      const now = Math.floor(Date.now() / TIME.MS_PER_SECOND);

      return now < lockExpiresAt;
    } catch (error) {
      logger.error(`Session ${sessionId}: Failed to check processing status:`, error);
      return false;
    }
  }
}
