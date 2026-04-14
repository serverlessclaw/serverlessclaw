import { DynamoMemory } from '../dynamo-memory';
import { MemoryCaches } from '../cache';

/**
 * Handles low-level delegation and system-related memory operations
 * for the CachedMemory provider.
 */
export class MemoryDelegator {
  constructor(private readonly underlying: DynamoMemory) {}

  async getMemoryByTypePaginated(
    type: string,
    limit?: number,
    lastEvaluatedKey?: Record<string, unknown>,
    workspaceId?: string
  ): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
    return this.underlying.getMemoryByTypePaginated(type, limit, lastEvaluatedKey, workspaceId);
  }

  async getMemoryByType(
    type: string,
    limit?: number,
    workspaceId?: string
  ): Promise<Record<string, unknown>[]> {
    return this.underlying.getMemoryByType(type, limit, workspaceId);
  }

  async getLowUtilizationMemory(limit?: number): Promise<Record<string, unknown>[]> {
    return this.underlying.getLowUtilizationMemory(limit);
  }

  async getRegisteredMemoryTypes(): Promise<string[]> {
    return this.underlying.getRegisteredMemoryTypes();
  }

  async recordMemoryHit(
    userId: string,
    timestamp: number | string,
    workspaceId?: string
  ): Promise<void> {
    await this.underlying.recordMemoryHit(userId, timestamp, workspaceId);
  }

  async saveLKGHash(hash: string): Promise<void> {
    await this.underlying.saveLKGHash(hash);
    MemoryCaches.global.delete('lkg_hash');
  }

  async getLatestLKGHash(): Promise<string | null> {
    const cacheKey = 'lkg_hash';
    const cached = MemoryCaches.global.get(cacheKey) as string | null | undefined;

    if (cached !== undefined) {
      return cached;
    }

    const hash = await this.underlying.getLatestLKGHash();
    MemoryCaches.global.set(cacheKey, hash, 15 * 60 * 1000);

    return hash;
  }

  async incrementRecoveryAttemptCount(): Promise<number> {
    return this.underlying.incrementRecoveryAttemptCount();
  }

  async resetRecoveryAttemptCount(): Promise<void> {
    await this.underlying.resetRecoveryAttemptCount();
  }

  async listByPrefix(prefix: string): Promise<Record<string, unknown>[]> {
    return this.underlying.listByPrefix(prefix);
  }

  async saveClarificationRequest(
    state: Omit<
      import('../../types/memory').ClarificationState,
      'type' | 'expiresAt' | 'timestamp'
    >,
    workspaceId?: string
  ): Promise<void> {
    await this.underlying.saveClarificationRequest(state, workspaceId);
  }

  async getClarificationRequest(
    traceId: string,
    agentId: string,
    workspaceId?: string
  ): Promise<import('../../types/memory').ClarificationState | null> {
    return this.underlying.getClarificationRequest(traceId, agentId, workspaceId);
  }

  async updateClarificationStatus(
    traceId: string,
    agentId: string,
    status: import('../../types/memory').ClarificationStatus,
    workspaceId?: string
  ): Promise<void> {
    await this.underlying.updateClarificationStatus(traceId, agentId, status, workspaceId);
  }

  async saveEscalationState(
    state: import('../../types/escalation').EscalationState,
    workspaceId?: string
  ): Promise<void> {
    await this.underlying.saveEscalationState(state, workspaceId);
  }

  async getEscalationState(
    traceId: string,
    agentId: string,
    workspaceId?: string
  ): Promise<import('../../types/escalation').EscalationState | null> {
    return this.underlying.getEscalationState(traceId, agentId, workspaceId);
  }

  async findExpiredClarifications(
    workspaceId?: string
  ): Promise<import('../../types/memory').ClarificationState[]> {
    return this.underlying.findExpiredClarifications(workspaceId);
  }

  async incrementClarificationRetry(
    traceId: string,
    agentId: string,
    workspaceId?: string
  ): Promise<number> {
    return this.underlying.incrementClarificationRetry(traceId, agentId, workspaceId);
  }
}
