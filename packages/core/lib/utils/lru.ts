/**
 * LRU Cache and Set utilities for memory-efficient state management.
 */

export class LRUSet<T> {
  private readonly max: number;
  private readonly items: Set<T>;

  constructor(max: number) {
    this.max = max;
    this.items = new Set();
  }

  add(item: T): void {
    if (this.items.has(item)) {
      this.items.delete(item);
    } else if (this.items.size >= this.max) {
      // Remove first item (oldest inserted)
      const first = this.items.values().next().value;
      if (first !== undefined) this.items.delete(first);
    }
    this.items.add(item);
  }

  has(item: T): boolean {
    if (this.items.has(item)) {
      // Move to end (most recently used)
      this.items.delete(item);
      this.items.add(item);
      return true;
    }
    return false;
  }

  delete(item: T): void {
    this.items.delete(item);
  }

  clear(): void {
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}

export class LRUCache<K, V> {
  private readonly max: number;
  private readonly items: Map<K, V>;

  constructor(max: number) {
    this.max = max;
    this.items = new Map();
  }

  set(key: K, value: V): void {
    if (this.items.has(key)) {
      this.items.delete(key);
    } else if (this.items.size >= this.max) {
      // Remove first item (oldest inserted)
      const firstKey = this.items.keys().next().value;
      if (firstKey !== undefined) this.items.delete(firstKey);
    }
    this.items.set(key, value);
  }

  get(key: K): V | undefined {
    if (this.items.has(key)) {
      const value = this.items.get(key)!;
      // Move to end (most recently used)
      this.items.delete(key);
      this.items.set(key, value);
      return value;
    }
    return undefined;
  }

  has(key: K): boolean {
    return this.items.has(key);
  }

  delete(key: K): void {
    this.items.delete(key);
  }

  clear(): void {
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }

  values(): IterableIterator<V> {
    return this.items.values();
  }

  entries(): IterableIterator<[K, V]> {
    return this.items.entries();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.items.entries();
  }
}
