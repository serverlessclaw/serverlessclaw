import { describe, it, expect } from 'vitest';
import { LRUSet, LRUCache } from './lru';

describe('LRUSet', () => {
  it('should add and check items', () => {
    const set = new LRUSet<string>(3);
    set.add('a');
    set.add('b');
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.has('c')).toBe(false);
    expect(set.size).toBe(2);
  });

  it('should evict oldest item when capacity exceeded', () => {
    const set = new LRUSet<string>(3);
    set.add('a');
    set.add('b');
    set.add('c');
    set.add('d');
    expect(set.size).toBe(3);
    expect(set.has('a')).toBe(false);
    expect(set.has('d')).toBe(true);
  });

  it('should promote item on has() access', () => {
    const set = new LRUSet<string>(3);
    set.add('a');
    set.add('b');
    set.add('c');
    set.has('a'); // promote 'a' to most recent
    set.add('d');
    expect(set.has('a')).toBe(true); // 'a' was promoted, so 'b' was evicted
    expect(set.has('b')).toBe(false);
  });

  it('should not duplicate existing items', () => {
    const set = new LRUSet<string>(3);
    set.add('a');
    set.add('b');
    set.add('a'); // re-add 'a' — should move to end, not duplicate
    expect(set.size).toBe(2);
  });

  it('should delete items', () => {
    const set = new LRUSet<string>(3);
    set.add('a');
    set.add('b');
    set.delete('a');
    expect(set.has('a')).toBe(false);
    expect(set.size).toBe(1);
  });

  it('should clear all items', () => {
    const set = new LRUSet<string>(3);
    set.add('a');
    set.add('b');
    set.clear();
    expect(set.size).toBe(0);
  });

  it('should handle capacity of 1', () => {
    const set = new LRUSet<string>(1);
    set.add('a');
    set.add('b');
    expect(set.size).toBe(1);
    expect(set.has('a')).toBe(false);
    expect(set.has('b')).toBe(true);
  });
});

describe('LRUCache', () => {
  it('should set and get values', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBeUndefined();
  });

  it('should evict oldest key when capacity exceeded', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('d')).toBe(4);
    expect(cache.size).toBe(3);
  });

  it('should promote key on get() access', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // promote 'a' to most recent
    cache.set('d', 4);
    expect(cache.has('a')).toBe(true); // 'a' was promoted
    expect(cache.has('b')).toBe(false); // 'b' was evicted
  });

  it('should update existing key without growing size', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('a', 10);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe(10);
  });

  it('should delete keys', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(cache.has('a')).toBe(false);
    expect(cache.size).toBe(1);
  });

  it('should clear all entries', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('should return values iterator', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    const values = [...cache.values()];
    expect(values).toEqual([1, 2]);
  });

  it('should return entries iterator', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    const entries = [...cache.entries()];
    expect(entries).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('should be iterable via Symbol.iterator', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    const entries = [...cache];
    expect(entries).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('should handle capacity of 1', () => {
    const cache = new LRUCache<string, number>(1);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(1);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
  });
});
