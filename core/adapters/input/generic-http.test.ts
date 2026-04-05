import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenericHTTPAdapter } from './generic-http';
import { logger } from '../../lib/logger';

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('GenericHTTPAdapter', () => {
  let adapter: GenericHTTPAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GenericHTTPAdapter();
  });

  describe('source', () => {
    it('should have the correct source', () => {
      expect(adapter.source).toBe('generic-http');
    });
  });

  describe('parse', () => {
    describe('raw object input', () => {
      it('should parse with raw object input (not string, not API Gateway event)', () => {
        const raw = {
          userId: 'user123',
          text: 'Hello from raw object',
        };

        const result = adapter.parse(raw);

        expect(result.source).toBe('generic-http');
        expect(result.userId).toBe('user123');
        expect(result.sessionId).toBe('user123');
        expect(result.text).toBe('Hello from raw object');
        expect(result.attachments).toEqual([]);
        expect(result.metadata).toEqual({});
        expect(result.timestamp).toBeDefined();
      });
    });

    describe('attachments', () => {
      it('should parse with attachments in payload', () => {
        const raw = {
          userId: 'user456',
          text: 'Message with attachments',
          attachments: [
            {
              type: 'image',
              url: 'https://example.com/image.png',
              mimeType: 'image/png',
              name: 'image.png',
            },
            {
              type: 'file',
              url: 'https://example.com/doc.pdf',
              mimeType: 'application/pdf',
              name: 'doc.pdf',
            },
          ],
        };

        const result = adapter.parse(raw);

        expect(result.attachments).toHaveLength(2);
        expect(result.attachments[0].type).toBe('image');
        expect(result.attachments[0].url).toBe('https://example.com/image.png');
        expect(result.attachments[1].type).toBe('file');
        expect(result.attachments[1].url).toBe('https://example.com/doc.pdf');
      });

      it('should default attachments to empty array when not provided', () => {
        const raw = {
          userId: 'user-no-attach',
          text: 'No attachments',
        };

        const result = adapter.parse(raw);

        expect(result.attachments).toEqual([]);
      });
    });

    describe('metadata', () => {
      it('should parse with metadata in payload', () => {
        const raw = {
          userId: 'user789',
          text: 'Message with metadata',
          metadata: {
            source: 'webhook',
            priority: 'high',
            tags: ['urgent', 'review'],
          },
        };

        const result = adapter.parse(raw);

        expect(result.metadata.source).toBe('webhook');
        expect(result.metadata.priority).toBe('high');
        expect(result.metadata.tags).toEqual(['urgent', 'review']);
      });

      it('should default metadata to empty object when not provided', () => {
        const raw = {
          userId: 'user-no-meta',
          text: 'No metadata',
        };

        const result = adapter.parse(raw);

        expect(result.metadata).toEqual({});
      });
    });

    describe('API Gateway events', () => {
      it('should parse API Gateway event with valid JSON body', () => {
        const raw = {
          body: JSON.stringify({
            userId: 'user2',
            sessionId: 'session1',
            text: 'API message',
            metadata: { source: 'api' },
          }),
        };

        const result = adapter.parse(raw);

        expect(result.userId).toBe('user2');
        expect(result.sessionId).toBe('session1');
        expect(result.text).toBe('API message');
        expect(result.metadata.source).toBe('api');
      });

      it('should parse with API Gateway event having null body (falls back to raw object)', () => {
        const raw = {
          body: null,
          headers: { 'content-type': 'application/json' },
          userId: 'api-user',
          text: 'Fallback from null body',
        };

        const result = adapter.parse(raw);

        expect(result.source).toBe('generic-http');
        expect(result.userId).toBe('api-user');
        expect(result.text).toBe('Fallback from null body');
      });

      it('should throw with invalid JSON in API Gateway event body', () => {
        const raw = {
          body: 'not-valid-json{{{',
          headers: { 'content-type': 'application/json' },
        };

        expect(() => adapter.parse(raw)).toThrow('Invalid JSON payload');
      });
    });

    describe('JSON string input', () => {
      it('should parse a valid JSON string', () => {
        const raw = JSON.stringify({
          userId: 'user1',
          text: 'Test message',
        });

        const result = adapter.parse(raw);

        expect(result.source).toBe('generic-http');
        expect(result.userId).toBe('user1');
        expect(result.sessionId).toBe('user1');
        expect(result.text).toBe('Test message');
      });

      it('should throw on invalid JSON string', () => {
        const raw = 'this is not json';

        expect(() => adapter.parse(raw)).toThrow('Invalid JSON payload');
      });
    });

    describe('schema validation failures', () => {
      it('should throw when text field is missing (schema validation failure)', () => {
        const raw = {
          userId: 'user123',
        };

        expect(() => adapter.parse(raw)).toThrow(/Invalid generic webhook payload/);
        expect(vi.mocked(logger).error).toHaveBeenCalled();
      });

      it('should throw when userId field is missing (schema validation failure)', () => {
        const raw = {
          text: 'No user here',
        };

        expect(() => adapter.parse(raw)).toThrow(/Invalid generic webhook payload/);
        expect(vi.mocked(logger).error).toHaveBeenCalled();
      });

      it('should throw when userId is not a string', () => {
        const raw = {
          userId: 12345,
          text: 'Bad userId type',
        };

        expect(() => adapter.parse(raw)).toThrow(/Invalid generic webhook payload/);
        expect(vi.mocked(logger).error).toHaveBeenCalled();
      });

      it('should throw when text is not a string', () => {
        const raw = {
          userId: 'user-bad-text',
          text: 42,
        };

        expect(() => adapter.parse(raw)).toThrow(/Invalid generic webhook payload/);
        expect(vi.mocked(logger).error).toHaveBeenCalled();
      });
    });

    describe('sessionId fallback', () => {
      it('should fall back sessionId to userId when sessionId is not provided', () => {
        const raw = {
          userId: 'fallback-user',
          text: 'No session id provided',
        };

        const result = adapter.parse(raw);

        expect(result.sessionId).toBe('fallback-user');
      });

      it('should use provided sessionId over userId fallback', () => {
        const raw = {
          userId: 'user-abc',
          sessionId: 'session-xyz',
          text: 'Explicit session',
        };

        const result = adapter.parse(raw);

        expect(result.sessionId).toBe('session-xyz');
        expect(result.userId).toBe('user-abc');
      });
    });

    describe('all optional fields', () => {
      it('should parse with all optional fields present', () => {
        const raw = {
          userId: 'full-user',
          sessionId: 'full-session',
          text: 'Complete payload',
          attachments: [
            {
              type: 'image',
              url: 'https://example.com/photo.jpg',
              mimeType: 'image/jpeg',
              name: 'photo.jpg',
            },
          ],
          metadata: {
            channel: 'api',
            version: '2.0',
          },
        };

        const result = adapter.parse(raw);

        expect(result.source).toBe('generic-http');
        expect(result.userId).toBe('full-user');
        expect(result.sessionId).toBe('full-session');
        expect(result.text).toBe('Complete payload');
        expect(result.attachments).toHaveLength(1);
        expect(result.attachments[0].type).toBe('image');
        expect(result.attachments[0].url).toBe('https://example.com/photo.jpg');
        expect(result.metadata.channel).toBe('api');
        expect(result.metadata.version).toBe('2.0');
        expect(result.timestamp).toBeDefined();
      });
    });
  });
});
