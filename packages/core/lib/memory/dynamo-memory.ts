import { IMemory } from '../types/index';
import { DynamoMemoryCollaboration } from './dynamo/collaboration';

export { CachedMemory } from './cached-memory';

/**
 * Implementation of IMemory using AWS DynamoDB for persistent storage
 * with a tiered retention strategy.
 *
 * This class is now modularized into an inheritance chain in the ./dynamo directory
 * to comply with AI context budget and file length standards.
 *
 * Chain: BaseMemoryProvider -> DynamoMemoryBase -> DynamoMemoryGaps -> DynamoMemoryInsights -> DynamoMemorySessions -> DynamoMemoryCollaboration -> DynamoMemory
 */
export class DynamoMemory extends DynamoMemoryCollaboration implements IMemory {
  /**
   * Gets cache statistics for monitoring.
   * Implementation is currently a placeholder as DynamoMemory is stateless.
   */
  getCacheStats() {
    return {
      userData: { hits: 0, misses: 0, evictions: 0, size: 0 },
      conversation: { hits: 0, misses: 0, evictions: 0, size: 0 },
      global: { hits: 0, misses: 0, evictions: 0, size: 0 },
      search: { hits: 0, misses: 0, evictions: 0, size: 0 },
      overallHitRate: 0,
    };
  }
}
