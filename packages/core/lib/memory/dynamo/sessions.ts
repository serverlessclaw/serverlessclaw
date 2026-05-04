import { IHistoryStore, Message, ConversationMeta, ContextualScope } from '../../types';
import { DynamoMemoryInsights } from './insights';
import * as SessionOps from '../session-operations';

/**
 * DynamoMemory implementation for Session and History operations.
 */
export class DynamoMemorySessions extends DynamoMemoryInsights implements IHistoryStore {
  async addMessage(
    userId: string,
    message: Message,
    scope?: string | ContextualScope
  ): Promise<void> {
    return SessionOps.addMessage(this, userId, message, scope);
  }

  async deleteConversation(
    userId: string,
    sessionId: string,
    scope?: string | ContextualScope
  ): Promise<void> {
    return SessionOps.deleteConversation(this, userId, sessionId, scope);
  }

  async updateDistilledMemory(
    userId: string,
    facts: string,
    scope?: string | ContextualScope
  ): Promise<void> {
    return SessionOps.updateDistilledMemory(this, userId, facts, scope);
  }

  async saveConversationMeta(
    userId: string,
    sessionId: string,
    meta: Partial<ConversationMeta>,
    scope?: string | ContextualScope
  ): Promise<void> {
    return SessionOps.saveConversationMeta(this, userId, sessionId, meta, scope);
  }

  async saveLKGHash(hash: string): Promise<void> {
    return SessionOps.saveLKGHash(this, hash);
  }

  async getLatestLKGHash(): Promise<string | null> {
    return SessionOps.getLatestLKGHash(this);
  }

  async incrementRecoveryAttemptCount(): Promise<number> {
    return SessionOps.incrementRecoveryAttemptCount(this);
  }

  async resetRecoveryAttemptCount(): Promise<void> {
    return SessionOps.resetRecoveryAttemptCount(this);
  }

  async getSummary(userId: string, scope?: string | ContextualScope): Promise<string | null> {
    return SessionOps.getSummary(this, userId, scope);
  }

  async updateSummary(
    userId: string,
    summary: string,
    scope?: string | ContextualScope
  ): Promise<void> {
    return SessionOps.updateSummary(this, userId, summary, scope);
  }
  async getSessionMetadata(
    sessionId: string,
    scope?: string | ContextualScope
  ): Promise<ConversationMeta | null> {
    return SessionOps.getSessionMetadata(this, sessionId, scope);
  }
}
