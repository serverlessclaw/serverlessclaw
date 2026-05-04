import { describe, it, expect } from 'vitest';
import { decodePaginationToken, encodePaginationToken } from './pagination-utils';

describe('Pagination Utils', () => {
  describe('decodePaginationToken', () => {
    it('decodes a valid base64 token', () => {
      const key = { pk: 'USER#1', sk: 'SESS#1' };
      const token = Buffer.from(JSON.stringify(key)).toString('base64');
      expect(decodePaginationToken(token)).toEqual(key);
    });

    it('returns undefined for empty token', () => {
      expect(decodePaginationToken('')).toBeUndefined();
    });

    it('returns undefined for invalid base64 or JSON', () => {
      expect(decodePaginationToken('invalid-base64!!!')).toBeUndefined();
    });
  });

  describe('encodePaginationToken', () => {
    it('encodes a valid key object', () => {
      const key = { pk: 'USER#1', sk: 'SESS#1' };
      const token = encodePaginationToken(key);
      expect(typeof token).toBe('string');
      expect(decodePaginationToken(token!)).toEqual(key);
    });

    it('returns undefined for missing key', () => {
      expect(encodePaginationToken(undefined)).toBeUndefined();
    });

    it('returns undefined if JSON.stringify fails (rare)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const circular: any = {};
      circular.self = circular;
      expect(encodePaginationToken(circular)).toBeUndefined();
    });
  });
});
