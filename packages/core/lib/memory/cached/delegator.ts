import type { IMemory } from '../../types/memory';
import { MemoryCaches } from '../cache';

/**
 * Handles low-level delegation and system-related memory operations
 * for the CachedMemory provider.
 */
export class MemoryDelegator {
  constructor(private readonly underlying: IMemory) {}

  async getMemoryByTypePaginated(
    type: string,
    limit?: number,
    lastEvaluatedKey?: Record<string, unknown>,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<{ items: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }> {
    return this.underlying.getMemoryByTypePaginated(type, limit, lastEvaluatedKey, scope);
  }

  async getMemoryByType(
    type: string,
    limit?: number,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<Record<string, unknown>[]> {
    return this.underlying.getMemoryByType(type, limit, scope);
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
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.recordMemoryHit(userId, timestamp, scope);
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
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.saveClarificationRequest(state, scope);
  }

  async getClarificationRequest(
    traceId: string,
    agentId: string,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<import('../../types/memory').ClarificationState | null> {
    return this.underlying.getClarificationRequest(traceId, agentId, scope);
  }

  async updateClarificationStatus(
    traceId: string,
    agentId: string,
    status: import('../../types/memory').ClarificationStatus,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.updateClarificationStatus(traceId, agentId, status, scope);
  }

  async saveEscalationState(
    state: import('../../types/escalation').EscalationState,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<void> {
    await this.underlying.saveEscalationState(state, scope);
  }

  async getEscalationState(
    traceId: string,
    agentId: string,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<import('../../types/escalation').EscalationState | null> {
    return this.underlying.getEscalationState(traceId, agentId, scope);
  }

  async findExpiredClarifications(
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<import('../../types/memory').ClarificationState[]> {
    return this.underlying.findExpiredClarifications(scope);
  }

  async incrementClarificationRetry(
    traceId: string,
    agentId: string,
    scope?: string | import('../../types/memory').ContextualScope
  ): Promise<number> {
    return this.underlying.incrementClarificationRetry(traceId, agentId, scope);
  }
}
