import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';

vi.mock('@/lib/constants', () => ({
  HTTP_STATUS: {
    OK: 200,
    BAD_REQUEST: 400,
    INTERNAL_SERVER_ERROR: 500,
  },
}));

import { withApiHandler, ApiError, requireFields, requireEnum, validateBody } from './api-handler';

describe('api-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ApiError', () => {
    it('creates an error with message and status code', () => {
      const error = new ApiError('Not found', 404);
      expect(error.message).toBe('Not found');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('ApiError');
      expect(error).toBeInstanceOf(Error);
    });

    it('defaults to 500 status code', () => {
      const error = new ApiError('Server error');
      expect(error.statusCode).toBe(500);
    });

    it('includes optional details', () => {
      const error = new ApiError('Invalid', 400, 'Field x is required');
      expect(error.details).toBe('Field x is required');
    });
  });

  describe('withApiHandler', () => {
    it('wraps handler and returns JSON response on success', async () => {
      const handler = withApiHandler(async (body) => {
        return { id: body.id, processed: true };
      });

      const req = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ id: '123' }),
      });

      const res = await handler(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBe('123');
      expect(data.processed).toBe(true);
    });

    it('returns structured error for ApiError', async () => {
      const handler = withApiHandler(async () => {
        throw new ApiError('Invalid input', 400, 'Missing field');
      });

      const req = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const res = await handler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe('Invalid input');
      expect(data.details).toBe('Missing field');
    });

    it('returns 500 for unexpected errors', async () => {
      const handler = withApiHandler(async () => {
        throw new Error('Unexpected failure');
      });

      const req = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const res = await handler(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe('Internal Server Error');
      expect(data.details).toBe('Unexpected failure');
    });

    it('passes request object to handler', async () => {
      const handler = withApiHandler(async (_body, req) => {
        return { url: req.url };
      });

      const req = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const res = await handler(req);
      const data = await res.json();

      expect(data.url).toBe('http://localhost/api/test');
    });
  });

  describe('requireFields', () => {
    it('does not throw when all required fields present', () => {
      expect(() => requireFields({ a: 1, b: 'two' }, 'a', 'b')).not.toThrow();
    });

    it('throws ApiError for missing fields', () => {
      expect(() => requireFields({ a: 1 }, 'a', 'b', 'c')).toThrow(ApiError);
      try {
        requireFields({ a: 1 }, 'a', 'b', 'c');
      } catch (e) {
        expect((e as ApiError).message).toContain('b');
        expect((e as ApiError).message).toContain('c');
        expect((e as ApiError).statusCode).toBe(400);
      }
    });

    it('treats null as missing', () => {
      expect(() => requireFields({ a: null }, 'a')).toThrow('Missing required parameters: a');
    });

    it('treats undefined as missing', () => {
      expect(() => requireFields({ a: undefined }, 'a')).toThrow('Missing required parameters: a');
    });

    it('allows empty string, 0, and false', () => {
      expect(() => requireFields({ a: '', b: 0, c: false }, 'a', 'b', 'c')).not.toThrow();
    });
  });

  describe('requireEnum', () => {
    it('does not throw for valid values', () => {
      expect(() => requireEnum('active', ['active', 'inactive'], 'status')).not.toThrow();
    });

    it('throws ApiError for invalid values', () => {
      try {
        requireEnum('deleted', ['active', 'inactive'], 'status');
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect((e as ApiError).message).toContain('Invalid status');
        expect((e as ApiError).message).toContain('active');
        expect((e as ApiError).statusCode).toBe(400);
      }
    });
  });

  describe('validateBody', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().min(0),
    });

    it('returns parsed body for valid input', () => {
      const result = validateBody({ name: 'Alice', age: 30 }, schema);
      expect(result.name).toBe('Alice');
      expect(result.age).toBe(30);
    });

    it('throws ApiError for invalid input', () => {
      try {
        validateBody({ name: 'Alice', age: -1 }, schema);
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect((e as ApiError).statusCode).toBe(400);
        expect((e as ApiError).message).toContain('Validation failed');
      }
    });

    it('throws ApiError for missing required fields', () => {
      try {
        validateBody({ name: 'Alice' }, schema);
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect((e as ApiError).statusCode).toBe(400);
      }
    });
  });
});
