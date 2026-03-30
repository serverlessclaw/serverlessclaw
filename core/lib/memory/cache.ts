/**
 * @module MemoryCache
 * @description LRU cache implementation for frequently accessed memory items.
 * Reduces DynamoDB read operations by caching user preferences, distilled memory,
 * and global lessons with appropriate TTL.
 */

import { logger } from '../logger';

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

/**
 * Generic LRU cache with TTL support.
 * Optimized for memory access patterns in agent processing.
 */
export class MemoryCache<T = unknown> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private stats: CacheStats = { hits: 0, misses: 0, evictions: 0, size: 0 };

  constructor(
    private readonly maxSize: number = 1000,
    private readonly defaultTtlMs: number = 5 * 60 * 1000 // 5 minutes
  ) {}

  /**
   * Retrieves a value from cache if it exists and hasn't expired.
   * @param key - Cache key
   * @returns Cached value or undefined if not found/expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // Update access order for LRU
    this.updateAccessOrder(key);
    this.stats.hits++;

    return entry.value;
  }

  /**
   * Stores a value in cache with optional custom TTL.
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttlMs - Optional custom TTL in milliseconds
   */
  set(key: string, value: T, ttlMs?: number): void {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl: ttlMs ?? this.defaultTtlMs,
    };

    this.cache.set(key, entry);
    this.updateAccessOrder(key);
    this.stats.size = this.cache.size;
  }

  /**
   * Deletes a specific cache entry.
   * @param key - Cache key to delete
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.size = this.cache.size;
    }
    return deleted;
  }

  /**
   * Invalidates all cache entries matching a pattern.
   * @param pattern - Regex pattern to match keys
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Invalidates all entries for a specific user.
   * @param userId - User ID to invalidate
   */
  invalidateUser(userId: string): number {
    // Matches keys where userId is at the start or follows a colon
    return this.invalidatePattern(new RegExp(`(^|:)${userId}(:|$)`));
  }

  /**
   * Clears the entire cache.
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0, size: 0 };
  }

  /**
   * Returns current cache statistics.
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Returns cache hit rate as a percentage.
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  /**
   * Checks if a key exists in cache and is not expired.
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Gets multiple keys at once.
   * @param keys - Array of cache keys
   * @returns Map of key-value pairs for found entries
   */
  getMany(keys: string[]): Map<string, T> {
    const result = new Map<string, T>();
    for (const key of keys) {
      const value = this.get(key);
      if (value !== undefined) {
        result.set(key, value);
      }
    }
    return result;
  }

  /**
   * Sets multiple key-value pairs at once.
   * @param entries - Array of [key, value, ttl?] tuples
   */
  setMany(entries: Array<[string, T, number?]>): void {
    for (const [key, value, ttl] of entries) {
      this.set(key, value, ttl);
    }
  }

  private updateAccessOrder(key: string): void {
    // Move to end (most recently used) by re-inserting
    const entry = this.cache.get(key);
    if (entry !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, entry);
    }
  }

  private evictLRU(): void {
    // First key in Map iteration order is the least recently used
    const lruKey = this.cache.keys().next().value;
    if (lruKey !== undefined) {
      this.cache.delete(lruKey);
      this.stats.evictions++;
      logger.debug(`Cache evicted LRU key: ${lruKey}`);
    }
  }
}

/**
 * Cache keys generator for consistent key formatting.
 */
export const CacheKeys = {
  /**
   * Key for user distilled memory.
   */
  distilledMemory: (userId: string) => `distilled:${userId}`,

  /**
   * Key for user lessons.
   */
  lessons: (userId: string) => `lessons:${userId}`,

  /**
   * Key for user preferences.
   */
  preferences: (userId: string) => `prefs:${userId}`,

  /**
   * Key for conversation history.
   */
  history: (storageId: string) => `history:${storageId}`,

  /**
   * Key for conversation summary.
   */
  summary: (storageId: string) => `summary:${storageId}`,

  /**
   * Key for global lessons.
   */
  globalLessons: (limit: number) => `global_lessons:${limit}`,

  /**
   * Key for memory insights search results.
   */
  insightsSearch: (userId: string, query: string, category?: string, tags?: string[]) =>
    `insights:${userId}:${query}:${category ?? 'all'}:${tags?.sort().join(',') ?? 'none'}`,

  /**
   * Key for gap information.
   */
  gap: (gapId: string) => `gap:${gapId}`,

  /**
   * Key for all gaps by status.
   */
  gapsByStatus: (status: string) => `gaps:${status}`,
} as const;

/**
 * Default cache instances for different data types with optimized TTLs.
 */
export const MemoryCaches = {
  /**
   * Cache for user-specific data (distilled memory, preferences).
   * TTL: 5 minutes (user data changes moderately)
   */
  userData: new MemoryCache<unknown>(500, 5 * 60 * 1000),

  /**
   * Cache for conversation history and summaries.
   * TTL: 2 minutes (conversations update frequently)
   */
  conversation: new MemoryCache<unknown>(1000, 2 * 60 * 1000),

  /**
   * Cache for global/system-wide data (global lessons, system config).
   * TTL: 15 minutes (system data changes infrequently)
   */
  global: new MemoryCache<unknown>(100, 15 * 60 * 1000),

  /**
   * Cache for search results and queries.
   * TTL: 3 minutes (search results may change with new data)
   */
  search: new MemoryCache<unknown>(200, 3 * 60 * 1000),
} as const;

/**
 * Utility function to get cache statistics for monitoring.
 */
export function getCacheStatsSummary(): {
  userData: CacheStats;
  conversation: CacheStats;
  global: CacheStats;
  search: CacheStats;
  overallHitRate: number;
} {
  const userDataStats = MemoryCaches.userData.getStats();
  const conversationStats = MemoryCaches.conversation.getStats();
  const globalStats = MemoryCaches.global.getStats();
  const searchStats = MemoryCaches.search.getStats();

  const totalHits =
    userDataStats.hits + conversationStats.hits + globalStats.hits + searchStats.hits;
  const totalMisses =
    userDataStats.misses + conversationStats.misses + globalStats.misses + searchStats.misses;
  const overallHitRate =
    totalHits + totalMisses > 0 ? (totalHits / (totalHits + totalMisses)) * 100 : 0;

  return {
    userData: userDataStats,
    conversation: conversationStats,
    global: globalStats,
    search: searchStats,
    overallHitRate,
  };
}
