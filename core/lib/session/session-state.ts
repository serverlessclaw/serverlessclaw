import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { PendingMessage } from '../types/session';
import { logger } from '../logger';
import { TIME, RETENTION } from '../constants';

import { LockManager } from '../lock/lock-manager';

const SESSION_PREFIX = 'SESSION_STATE#';
const LOCK_PREFIX = 'LOCK#SESSION#';
const LOCK_TTL_SECONDS = 300; // 5 minutes for lock timeout (crash recovery)
const SESSION_TTL_SECONDS = RETENTION.SESSION_METADATA_DAYS * 24 * 60 * 60; // Uses centralized RETENTION config

import { getMemoryTableName } from '../utils/ddb-client';

// Default client for backward compatibility - can be overridden via constructor for testing
const defaultClient = new DynamoDBClient({});
const defaultDocClient = DynamoDBDocumentClient.from(defaultClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export interface SessionState {
  sessionId: string;
  processingAgentId: string | null;
  processingStartedAt: number | null;
  pendingMessages: PendingMessage[];
  lastMessageAt: number;
  workflowSnapshot?: {
    reason: string;
    timestamp: number;
    agentId: string;
    task: string;
    state: any;
    metadata?: any;
  } | null;
}

export class SessionStateManager {
  private docClient: DynamoDBDocumentClient;
  private lockManager: LockManager;
  private lastRenewedAt: Map<string, number> = new Map();

  constructor(docClient?: DynamoDBDocumentClient) {
    this.docClient = docClient ?? defaultDocClient;
    this.lockManager = new LockManager(this.docClient);
  }

  private get tableName(): string {
    return getMemoryTableName() ?? 'MemoryTable';
  }

  private getKey(sessionId: string): string {
    return `${SESSION_PREFIX}${sessionId}`;
  }

  private getSessionExpiresAt(): number {
    return Math.floor(Date.now() / TIME.MS_PER_SECOND) + SESSION_TTL_SECONDS;
  }

  /**
   * Attempts to acquire the processing lock for a session.
   * Uses unified LockManager for consistent distributed coordination.
   */
  async acquireProcessing(
    sessionId: string,
    agentId: string,
    scope?: { workspaceId?: string; teamId?: string; staffId?: string }
  ): Promise<boolean> {
    const lockId = `${LOCK_PREFIX}${sessionId}`;
    const nowSec = Math.floor(Date.now() / TIME.MS_PER_SECOND);
    const lockExpiresAt = nowSec + LOCK_TTL_SECONDS;

    const acquired = await this.lockManager.acquire(lockId, {
      ownerId: agentId,
      ttlSeconds: LOCK_TTL_SECONDS,
      prefix: '', // We already prefixed it
    });

    if (acquired) {
      this.lastRenewedAt.set(sessionId, Date.now());
      // Also update the session record to reflect who is processing (B3 Awareness)
      const key = this.getKey(sessionId);
      try {
        await this.docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { userId: key, timestamp: 0 },
            UpdateExpression:
              'SET processingAgentId = :agentId, processingStartedAt = :now, lockExpiresAt = :lockExp, expiresAt = :exp, ' +
              'pendingMessages = if_not_exists(pendingMessages, :empty), ' +
              'workspaceId = :ws, teamId = :team, staffId = :staff',
            ExpressionAttributeValues: {
              ':agentId': agentId,
              ':now': Date.now(),
              ':lockExp': lockExpiresAt,
              ':exp': this.getSessionExpiresAt(),
              ':empty': [],
              ':ws': scope?.workspaceId ?? null,
              ':team': scope?.teamId ?? null,
              ':staff': scope?.staffId ?? null,
            },
          })
        );
      } catch (error) {
        logger.warn(`Session ${sessionId}: Lock acquired but state update failed.`, error);
      }
      logger.info(`Session ${sessionId}: Processing lock acquired by ${agentId}`);
      return true;
    }

    logger.info(`Session ${sessionId}: Already being processed by another agent (Lock held)`);
    return false;
  }

  /**
   * Releases the processing lock for a session and re-emits any pending messages.
   */
  async releaseProcessing(sessionId: string, agentId: string): Promise<void> {
    const lockId = `${LOCK_PREFIX}${sessionId}`;
    this.lastRenewedAt.delete(sessionId);
    // 1. Release the lock item itself
    await this.lockManager.release(lockId, agentId, '');

    // 2. ALWAYS attempt to clear session metadata to prevent zombie "Processing" states in UI,
    // regardless of whether the lock release succeeded (it might have already expired).
    const key = this.getKey(sessionId);
    try {
      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { userId: key, timestamp: 0 },
          UpdateExpression:
            'SET processingAgentId = :null, processingStartedAt = :null, lockExpiresAt = :null, expiresAt = :exp',
          ConditionExpression: 'processingAgentId = :agentId',
          ExpressionAttributeValues: {
            ':null': null,
            ':agentId': agentId,
            ':exp': this.getSessionExpiresAt(),
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      // 3. P0 Reliability Fix: If there are pending messages, re-emit the first one to continue the chain
      const attributes = result.Attributes;
      if (attributes && attributes.pendingMessages?.length > 0) {
        const nextMsg = attributes.pendingMessages[0];
        logger.info(
          `Session ${sessionId}: Lock released, re-emitting next pending message: ${nextMsg.id}`
        );

        // Parse the content back into agent and task (Format: "agentId: task")
        const content = nextMsg.content as string;
        const separatorIndex = content.indexOf(':');
        if (separatorIndex !== -1) {
          const targetAgentId = content.substring(0, separatorIndex).trim();
          const taskContent = content.substring(separatorIndex + 1).trim();

          const { emitEvent } = await import('../utils/bus');

          await emitEvent(`${agentId}.session-release`, `dynamic_${targetAgentId}_task`, {
            userId: attributes.userId?.replace(SESSION_PREFIX, '') || 'unknown',
            task: taskContent,
            sessionId,
            traceId: `resume-${Date.now()}`,
            isContinuation: true,
            attachments: nextMsg.attachments,
            workspaceId: attributes.workspaceId,
            teamId: attributes.teamId,
            staffId: attributes.staffId,
          });

          // 4. Remove the processed message from the queue
          await this.removePendingMessage(sessionId, nextMsg.id);
        }
      }

      logger.info(`Session ${sessionId}: Processing metadata cleared for ${agentId}`);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        logger.debug(`Session ${sessionId}: Metadata already cleared or owned by another agent.`);
      } else {
        logger.error(`Session ${sessionId}: Failed to clear session metadata:`, error);
      }
    }
  }

  /**
   * Renews the processing lock TTL. Called periodically during long-running tasks.
   */
  async renewProcessing(sessionId: string, agentId: string): Promise<boolean> {
    const lockId = `${LOCK_PREFIX}${sessionId}`;
    const nowSec = Math.floor(Date.now() / TIME.MS_PER_SECOND);
    const newLockExpiresAt = nowSec + LOCK_TTL_SECONDS;

    const renewed = await this.lockManager.renew(lockId, {
      ownerId: agentId,
      ttlSeconds: LOCK_TTL_SECONDS,
      prefix: '',
    });

    if (renewed) {
      this.lastRenewedAt.set(sessionId, Date.now());
      // Sync the new expiry into the session record for B3 Awareness
      const key = this.getKey(sessionId);
      try {
        await this.docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { userId: key, timestamp: 0 },
            UpdateExpression: 'SET lockExpiresAt = :lockExp, expiresAt = :exp',
            ConditionExpression: 'processingAgentId = :agentId',
            ExpressionAttributeValues: {
              ':lockExp': newLockExpiresAt,
              ':exp': this.getSessionExpiresAt(),
              ':agentId': agentId,
            },
          })
        );
      } catch (error) {
        logger.warn(`Session ${sessionId}: Lock renewed but state sync failed.`, error);
      }
    }

    return renewed;
  }

  /**
   * Automatically renews the processing lock if it's nearing expiration.
   * Uses a threshold (default 50% of TTL) to avoid excessive DDB calls.
   */
  async autoRenew(sessionId: string, agentId: string, force: boolean = false): Promise<void> {
    const lastRenewed = this.lastRenewedAt.get(sessionId);
    if (!lastRenewed && !force) return;

    const now = Date.now();
    const thresholdMs = (LOCK_TTL_SECONDS * 1000) / 2; // Renew at 50% mark

    if (force || now - (lastRenewed ?? 0) > thresholdMs) {
      logger.debug(`[AUTO_RENEW] Nearing lock expiration for session ${sessionId}. Renewing...`);
      await this.renewProcessing(sessionId, agentId);
    }
  }

  /**
   * Adds a message to the pending queue.
   * Uses atomic conditional to prevent exceeding 50 messages - no race condition.
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

    const MAX_PENDING = 50;

    try {
      // Atomic append with conditional: only append if list size < MAX_PENDING
      // This prevents the race condition where two concurrent adds could both append
      // before either truncates, exceeding the limit
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            userId: key,
            timestamp: 0,
          },
          UpdateExpression:
            'SET pendingMessages = list_append(if_not_exists(pendingMessages, :empty), :msg), lastMessageAt = :now, expiresAt = :exp',
          ConditionExpression:
            'attribute_not_exists(pendingMessages) OR size(pendingMessages) < :max',
          ExpressionAttributeNames: {
            '#pm': 'pendingMessages',
          },
          ExpressionAttributeValues: {
            ':empty': [],
            ':msg': [pendingMessage],
            ':now': now,
            ':exp': this.getSessionExpiresAt(),
            ':max': MAX_PENDING,
          },
        })
      );

      logger.info(`Session ${sessionId}: Added pending message ${messageId}`);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        // Queue is full - this is expected under high load, not an error
        logger.warn(
          `Session ${sessionId}: Pending message queue full (${MAX_PENDING}), rejecting new message`
        );
        throw new Error(
          `PENDING_QUEUE_FULL: Session ${sessionId} has ${MAX_PENDING} pending messages`
        );
      }
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

      return (result.Item.pendingMessages as PendingMessage[]) ?? [];
    } catch (error) {
      logger.error(`Session ${sessionId}: Failed to get pending messages:`, error);
      return [];
    }
  }

  /**
   * Clears specific pending messages for a session to avoid race conditions.
   * Uses optimistic locking with pendingMessages field to handle concurrent modifications.
   */
  async clearPendingMessages(sessionId: string, messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;

    const key = this.getKey(sessionId);
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const currentMessages = await this.getPendingMessages(sessionId);
        const remainingMessages = currentMessages.filter((m) => !messageIds.includes(m.id));

        if (remainingMessages.length === currentMessages.length) {
          return;
        }

        // Use atomic list operation with optimistic condition
        await this.docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: {
              userId: key,
              timestamp: 0,
            },
            UpdateExpression:
              'SET pendingMessages = :remaining, expiresAt = :exp, #lastUpdate = :now',
            ConditionExpression: 'pendingMessages = :old',
            ExpressionAttributeNames: { '#lastUpdate': 'lastPendingMessageClear' },
            ExpressionAttributeValues: {
              ':remaining': remainingMessages,
              ':old': currentMessages,
              ':exp': this.getSessionExpiresAt(),
              ':now': Date.now(),
            },
          })
        );
        logger.info(`Session ${sessionId}: Cleared ${messageIds.length} processed messages`);
        return;
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          if (attempt === MAX_ATTEMPTS) {
            logger.error(
              `Session ${sessionId}: Failed to clear pending messages after ${MAX_ATTEMPTS} attempts due to race conditions.`
            );
            throw new Error('FAILED_TO_CLEAR_PENDING_MESSAGES_RACE_CONDITION');
          }
          logger.warn(
            `Session ${sessionId}: Race condition detected while clearing pending messages (attempt ${attempt}), retrying...`
          );
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
        } else {
          logger.error(`Session ${sessionId}: Failed to clear pending messages:`, error);
          throw error;
        }
      }
    }
  }

  /**
   * Removes a specific pending message by ID.
   * Now uses retry logic and optimistic locking (P1 Race Fix).
   */
  async removePendingMessage(sessionId: string, messageId: string): Promise<boolean> {
    const key = this.getKey(sessionId);
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const messages = await this.getPendingMessages(sessionId);
        const filtered = messages.filter((m) => m.id !== messageId);

        if (filtered.length === messages.length) {
          return false;
        }

        // Use atomic update with condition to prevent overwriting new messages (Race Fix)
        await this.docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { userId: key, timestamp: 0 },
            UpdateExpression:
              'SET pendingMessages = :filtered, expiresAt = :exp, #lastUpdate = :now',
            ConditionExpression: 'pendingMessages = :old',
            ExpressionAttributeNames: { '#lastUpdate': 'lastPendingMessageClear' },
            ExpressionAttributeValues: {
              ':filtered': filtered,
              ':old': messages,
              ':exp': this.getSessionExpiresAt(),
              ':now': Date.now(),
            },
          })
        );
        return true;
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          if (attempt === MAX_ATTEMPTS) {
            logger.error(
              `Session ${sessionId}: Failed to remove pending message after ${MAX_ATTEMPTS} attempts.`
            );
            return false;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
        } else {
          logger.error(`Session ${sessionId}: Failed to remove pending message:`, error);
          return false;
        }
      }
    }
    return false;
  }

  /**
   * Updates a specific pending message content.
   * Now uses retry logic and optimistic locking (P1 Race Fix).
   */
  async updatePendingMessage(
    sessionId: string,
    messageId: string,
    newContent: string
  ): Promise<boolean> {
    const key = this.getKey(sessionId);
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const messages = await this.getPendingMessages(sessionId);
        const updated = messages.map((m) =>
          m.id === messageId ? { ...m, content: newContent, timestamp: Date.now() } : m
        );

        if (JSON.stringify(messages) === JSON.stringify(updated)) {
          return false;
        }

        // Use atomic update with condition to prevent overwriting new messages (Race Fix)
        await this.docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { userId: key, timestamp: 0 },
            UpdateExpression:
              'SET pendingMessages = :updated, expiresAt = :exp, #lastUpdate = :now',
            ConditionExpression: 'pendingMessages = :old',
            ExpressionAttributeNames: { '#lastUpdate': 'lastPendingMessageClear' },
            ExpressionAttributeValues: {
              ':updated': updated,
              ':old': messages,
              ':exp': this.getSessionExpiresAt(),
              ':now': Date.now(),
            },
          })
        );
        return true;
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          if (attempt === MAX_ATTEMPTS) {
            logger.error(
              `Session ${sessionId}: Failed to update pending message after ${MAX_ATTEMPTS} attempts.`
            );
            return false;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
        } else {
          logger.error(`Session ${sessionId}: Failed to update pending message:`, error);
          return false;
        }
      }
    }
    return false;
  }

  /**
   * Saves a workflow snapshot for later resumption.
   */
  async saveSnapshot(
    sessionId: string,
    snapshot: NonNullable<SessionState['workflowSnapshot']>
  ): Promise<void> {
    const key = this.getKey(sessionId);
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { userId: key, timestamp: 0 },
          UpdateExpression: 'SET workflowSnapshot = :snapshot, expiresAt = :exp',
          ExpressionAttributeValues: {
            ':snapshot': snapshot,
            ':exp': this.getSessionExpiresAt(),
          },
        })
      );
      logger.info(`Session ${sessionId}: Workflow snapshot saved. Reason: ${snapshot.reason}`);
    } catch (error) {
      logger.error(`Session ${sessionId}: Failed to save workflow snapshot:`, error);
      throw error;
    }
  }

  /**
   * Clears a workflow snapshot.
   */
  async clearSnapshot(sessionId: string): Promise<void> {
    const key = this.getKey(sessionId);
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { userId: key, timestamp: 0 },
          UpdateExpression: 'SET workflowSnapshot = :null',
          ExpressionAttributeValues: {
            ':null': null,
          },
        })
      );
      logger.info(`Session ${sessionId}: Workflow snapshot cleared.`);
    } catch (error) {
      logger.error(`Session ${sessionId}: Failed to clear workflow snapshot:`, error);
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
        pendingMessages: (result.Item.pendingMessages as PendingMessage[]) ?? [],
        lastMessageAt: result.Item.lastMessageAt,
        workflowSnapshot: result.Item.workflowSnapshot,
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

      const lockExpiresAt = (result.Item.lockExpiresAt as number) || 0;
      const now = Math.floor(Date.now() / TIME.MS_PER_SECOND);

      return now < lockExpiresAt;
    } catch (error) {
      logger.error(`Session ${sessionId}: Failed to check processing status:`, error);
      return false;
    }
  }
}
