/**
 * Memory Utils Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMetadata,
  getMemoryByTypePaginated,
  getMemoryByType,
  getRegisteredMemoryTypes,
  queryLatestContentByUserId,
} from './utils';
import type { BaseMemoryProvider } from './base';
import { InsightCategory } from '../types/index';

describe('memory/utils', () => {
  let mockBase: BaseMemoryProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBase = {
      queryItems: vi.fn().mockResolvedValue([]),
      queryItemsPaginated: vi.fn().mockResolvedValue({ items: [], lastEvaluatedKey: undefined }),
    } as unknown as BaseMemoryProvider;
  });

  describe('createMetadata', () => {
    it('should create metadata with defaults', () => {
      const metadata = createMetadata();

      expect(metadata.category).toBe(InsightCategory.STRATEGIC_GAP);
      expect(metadata.confidence).toBe(5);
      expect(metadata.impact).toBe(5);
      expect(metadata.hitCount).toBe(0);
    });

    it('should allow overriding defaults', () => {
      const metadata = createMetadata({
        category: InsightCategory.USER_PREFERENCE,
        confidence: 9,
      });

      expect(metadata.category).toBe(InsightCategory.USER_PREFERENCE);
      expect(metadata.confidence).toBe(9);
      expect(metadata.impact).toBe(5); // default preserved
    });

    it('should set lastAccessed to provided timestamp', () => {
      const timestamp = 1234567890;
      const metadata = createMetadata({}, timestamp);

      expect(metadata.lastAccessed).toBe(timestamp);
    });

    it('should set lastAccessed to Date.now() when not provided', () => {
      const before = Date.now();
      const metadata = createMetadata();
      const after = Date.now();

      expect(metadata.lastAccessed).toBeGreaterThanOrEqual(before);
      expect(metadata.lastAccessed).toBeLessThanOrEqual(after);
    });

    it('should set createdAt to provided timestamp', () => {
      const timestamp = 1234567890;
      const metadata = createMetadata({}, timestamp);

      expect(metadata.createdAt).toBe(timestamp);
    });

    it('should allow overriding createdAt via overrides', () => {
      const timestamp = 1000;
      const createdAt = 500;
      const metadata = createMetadata({ createdAt }, timestamp);

      expect(metadata.createdAt).toBe(createdAt);
      expect(metadata.lastAccessed).toBe(timestamp);
    });
  });

  describe('getMemoryByTypePaginated', () => {
    it('should query with correct parameters', async () => {
      const mockItems = [{ id: '1', content: 'Test' }];
      mockBase.queryItemsPaginated = vi.fn().mockResolvedValue({
        items: mockItems,
        lastEvaluatedKey: undefined,
      });

      const result = await getMemoryByTypePaginated(mockBase, 'GAP', 50);

      expect(result.items).toEqual(mockItems);
      expect(mockBase.queryItemsPaginated).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: 'TypeTimestampIndex',
          KeyConditionExpression: '#type = :type',
          ExpressionAttributeValues: { ':type': 'GAP' },
          Limit: 50,
          ScanIndexForward: false,
        })
      );
    });

    it('should use default limit of 100', async () => {
      await getMemoryByTypePaginated(mockBase, 'LESSON');

      expect(mockBase.queryItemsPaginated).toHaveBeenCalledWith(
        expect.objectContaining({ Limit: 100 })
      );
    });

    it('should pass lastEvaluatedKey for pagination', async () => {
      const lastKey = { userId: 'GAP#123', timestamp: 1000 };

      await getMemoryByTypePaginated(mockBase, 'GAP', 50, lastKey);

      expect(mockBase.queryItemsPaginated).toHaveBeenCalledWith(
        expect.objectContaining({ ExclusiveStartKey: lastKey })
      );
    });

    it('should return lastEvaluatedKey in result', async () => {
      const nextKey = { userId: 'GAP#456', timestamp: 2000 };
      mockBase.queryItemsPaginated = vi.fn().mockResolvedValue({
        items: [],
        lastEvaluatedKey: nextKey,
      });

      const result = await getMemoryByTypePaginated(mockBase, 'GAP', 50);

      expect(result.lastEvaluatedKey).toEqual(nextKey);
    });
  });

  describe('getMemoryByType', () => {
    it('should return items from paginated query', async () => {
      const mockItems = [{ id: '1' }, { id: '2' }];
      mockBase.queryItemsPaginated = vi.fn().mockResolvedValue({
        items: mockItems,
        lastEvaluatedKey: undefined,
      });

      const result = await getMemoryByType(mockBase, 'GAP', 50);

      expect(result).toEqual(mockItems);
    });

    it('should use default limit of 100', async () => {
      await getMemoryByType(mockBase, 'LESSON');

      expect(mockBase.queryItemsPaginated).toHaveBeenCalledWith(
        expect.objectContaining({ Limit: 100 })
      );
    });
  });

  describe('getRegisteredMemoryTypes', () => {
    it('should return array of registered types', async () => {
      const activeTypes = ['MEMORY:PREFERENCE', 'LESSON', 'GAP'];
      mockBase.queryItems = vi.fn().mockResolvedValue([{ activeTypes }]);

      const result = await getRegisteredMemoryTypes(mockBase);

      expect(result).toEqual(activeTypes);
    });

    it('should handle Set type for activeTypes', async () => {
      const activeTypes = new Set(['MEMORY:PREFERENCE', 'LESSON']);
      mockBase.queryItems = vi.fn().mockResolvedValue([{ activeTypes }]);

      const result = await getRegisteredMemoryTypes(mockBase);

      expect(result).toEqual(['MEMORY:PREFERENCE', 'LESSON']);
    });

    it('should return empty array when no registry exists', async () => {
      mockBase.queryItems = vi.fn().mockResolvedValue([]);

      const result = await getRegisteredMemoryTypes(mockBase);

      expect(result).toEqual([]);
    });

    it('should return empty array when activeTypes is undefined', async () => {
      mockBase.queryItems = vi.fn().mockResolvedValue([{}]);

      const result = await getRegisteredMemoryTypes(mockBase);

      expect(result).toEqual([]);
    });

    it('should query SYSTEM#REGISTRY with timestamp 0', async () => {
      await getRegisteredMemoryTypes(mockBase);

      expect(mockBase.queryItems).toHaveBeenCalledWith(
        expect.objectContaining({
          KeyConditionExpression: 'userId = :userId AND #ts = :ts',
          ExpressionAttributeValues: expect.objectContaining({
            ':userId': 'SYSTEM#REGISTRY',
            ':ts': 0,
          }),
        })
      );
    });
  });

  describe('queryLatestContentByUserId', () => {
    it('should return content strings from items', async () => {
      mockBase.queryItems = vi
        .fn()
        .mockResolvedValue([{ content: 'Content 1' }, { content: 'Content 2' }]);

      const result = await queryLatestContentByUserId(mockBase, 'user123', 10);

      expect(result).toEqual(['Content 1', 'Content 2']);
    });

    it('should query with ScanIndexForward false for latest items', async () => {
      await queryLatestContentByUserId(mockBase, 'user123', 5);

      expect(mockBase.queryItems).toHaveBeenCalledWith(
        expect.objectContaining({
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: { ':userId': 'user123' },
          Limit: 5,
          ScanIndexForward: false,
        })
      );
    });

    it('should use default limit of 1', async () => {
      await queryLatestContentByUserId(mockBase, 'user123');

      expect(mockBase.queryItems).toHaveBeenCalledWith(expect.objectContaining({ Limit: 1 }));
    });

    it('should return empty array when no items found', async () => {
      mockBase.queryItems = vi.fn().mockResolvedValue([]);

      const result = await queryLatestContentByUserId(mockBase, 'user123');

      expect(result).toEqual([]);
    });
  });

  describe('queryByTypeAndMap', () => {
    it('should map items with createdAt correctly', async () => {
      const { queryByTypeAndMap: qMap } = await import('./utils');
      const timestamp = 1000;
      const createdAt = 500;
      mockBase.queryItems = vi.fn().mockResolvedValue([
        {
          userId: 'GAP#1',
          content: 'Test content',
          timestamp,
          createdAt,
          metadata: { category: InsightCategory.STRATEGIC_GAP },
        },
      ]);

      const result = await qMap(mockBase, 'GAP', InsightCategory.STRATEGIC_GAP);

      expect(result[0].createdAt).toBe(createdAt);
      expect(result[0].timestamp).toBe(timestamp);
    });

    it('should fallback to metadata.createdAt then timestamp', async () => {
      const { queryByTypeAndMap: qMap } = await import('./utils');
      const timestamp = 1000;
      const createdAt = 500;
      mockBase.queryItems = vi.fn().mockResolvedValue([
        {
          userId: 'GAP#1',
          content: 'Test',
          timestamp,
          metadata: { createdAt },
        },
        {
          userId: 'GAP#2',
          content: 'Test 2',
          timestamp: 2000,
        },
      ]);

      const result = await qMap(mockBase, 'GAP', InsightCategory.STRATEGIC_GAP);

      expect(result[0].createdAt).toBe(createdAt);
      expect(result[1].createdAt).toBe(2000);
    });
  });
});
