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
  normalizeTags,
  normalizeGapId,
  getGapIdPK,
  getGapTimestamp,
  queryByTypeAndGetContent,
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
      getScopedUserId: vi.fn().mockImplementation((uid, wid) => (wid ? `${uid}#${wid}` : uid)),
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
          KeyConditionExpression: '#tp = :type',
          ExpressionAttributeNames: { '#tp': 'type' },
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
            ':ts': '0',
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

  describe('normalizeTags', () => {
    it('should return empty array for empty array input', () => {
      expect(normalizeTags([])).toEqual([]);
    });

    it('should return empty array for null input', () => {
      expect(normalizeTags(null as unknown as string[])).toEqual([]);
    });

    it('should return empty array for undefined input', () => {
      expect(normalizeTags(undefined)).toEqual([]);
    });

    it('should trim whitespace from tags', () => {
      expect(normalizeTags(['  tag1  ', ' tag2 '])).toEqual(['tag1', 'tag2']);
    });

    it('should lowercase tags', () => {
      expect(normalizeTags(['TAG1', 'Tag2', 'tag3'])).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should remove duplicates', () => {
      expect(normalizeTags(['tag1', 'TAG1', ' tag1 '])).toEqual(['tag1']);
    });

    it('should handle mixed case with whitespace and duplicates', () => {
      expect(normalizeTags(['  TAG1  ', 'tag1', ' Tag1 ', 'tag2'])).toEqual(['tag1', 'tag2']);
    });

    it('should filter out non-string items', () => {
      expect(
        normalizeTags(['tag1', 123 as unknown as string, null as unknown as string, 'tag2'])
      ).toEqual(['tag1', 'tag2']);
    });

    it('should filter out empty strings after trim', () => {
      expect(normalizeTags(['  ', '', 'tag1'])).toEqual(['tag1']);
    });

    it('should return sorted array', () => {
      expect(normalizeTags(['zebra', 'alpha', 'beta'])).toEqual(['alpha', 'beta', 'zebra']);
    });
  });

  describe('normalizeGapId', () => {
    it('should return empty string for empty string input', () => {
      expect(normalizeGapId('')).toBe('');
    });

    it('should strip single GAP# prefix', () => {
      expect(normalizeGapId('GAP#123')).toBe('123');
    });

    it('should strip multiple GAP# prefixes', () => {
      expect(normalizeGapId('GAP#GAP#123')).toBe('123');
    });

    it('should strip PROC# prefix', () => {
      expect(normalizeGapId('PROC#123')).toBe('123');
    });

    it('should strip PROC# prefix followed by GAP#', () => {
      expect(normalizeGapId('PROC#GAP#456')).toBe('GAP#456');
    });

    it('should handle mixed prefixes', () => {
      expect(normalizeGapId('GAP#PROC#GAP#789')).toBe('GAP#789');
    });

    it('should return unchanged string if no prefix matches', () => {
      expect(normalizeGapId('123')).toBe('123');
    });
  });

  describe('getGapIdPK', () => {
    it('should return GAP# with numeric ID for standard gap ID', () => {
      expect(getGapIdPK('GAP#123')).toBe('GAP#123');
    });

    it('should strip prefix and return GAP# with numeric ID', () => {
      expect(getGapIdPK('PROC#GAP#456')).toBe('GAP#456');
    });

    it('should handle non-numeric gap IDs by returning GAP# with original normalized ID', () => {
      expect(getGapIdPK('GAP#abc')).toBe('GAP#abc');
    });

    it('should handle compound IDs', () => {
      expect(getGapIdPK('GAP#GAP#789')).toBe('GAP#789');
    });

    it('should extract trailing numeric portion', () => {
      expect(getGapIdPK('GAP#prefix123')).toBe('GAP#123');
    });
  });

  describe('getGapTimestamp', () => {
    it('should return numeric string for valid numeric gap ID', () => {
      expect(getGapTimestamp('GAP#123')).toBe('123');
    });

    it('should return 0 as string for non-numeric normalized ID', () => {
      expect(getGapTimestamp('GAP#abc')).toBe('0');
    });

    it('should handle NaN by returning 0 as string', () => {
      expect(getGapTimestamp('GAP#')).toBe('0');
    });

    it('should strip prefixes before parsing and return as string', () => {
      expect(getGapTimestamp('PROC#GAP#456')).toBe('456');
    });

    it('should return 0 as string for empty string', () => {
      expect(getGapTimestamp('')).toBe('0');
    });
  });

  describe('queryByTypeAndGetContent', () => {
    it('should use UserInsightIndex when userId is provided', async () => {
      mockBase.queryItems = vi.fn().mockResolvedValue([{ content: 'User content' }]);

      const result = await queryByTypeAndGetContent(mockBase, 'LESSON', 5, 'user123');

      expect(result).toEqual(['User content']);
      expect(mockBase.queryItems).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: 'UserInsightIndex',
          KeyConditionExpression: 'userId = :userId AND #tp = :type',
          ExpressionAttributeNames: { '#tp': 'type' },
          ExpressionAttributeValues: { ':userId': 'user123', ':type': 'LESSON' },
          Limit: 5,
          ScanIndexForward: false,
        })
      );
    });

    it('should use TypeTimestampIndex when userId is not provided', async () => {
      mockBase.queryItems = vi.fn().mockResolvedValue([{ content: 'Global content' }]);

      const result = await queryByTypeAndGetContent(mockBase, 'LESSON', 10);

      expect(result).toEqual(['Global content']);
      expect(mockBase.queryItems).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: 'TypeTimestampIndex',
          KeyConditionExpression: '#tp = :type',
          ExpressionAttributeNames: { '#tp': 'type' },
          ExpressionAttributeValues: { ':type': 'LESSON' },
          Limit: 10,
          ScanIndexForward: false,
        })
      );
    });

    it('should filter out empty content with filter(Boolean)', async () => {
      mockBase.queryItems = vi
        .fn()
        .mockResolvedValue([
          { content: 'Valid content' },
          { content: '' },
          { content: null },
          { content: undefined },
          { content: 'Another valid' },
        ]);

      const result = await queryByTypeAndGetContent(mockBase, 'LESSON', 10);

      expect(result).toEqual(['Valid content', 'Another valid']);
    });

    it('should return empty array when no items found', async () => {
      mockBase.queryItems = vi.fn().mockResolvedValue([]);

      const result = await queryByTypeAndGetContent(mockBase, 'LESSON', 10);

      expect(result).toEqual([]);
    });
  });
});
