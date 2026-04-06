import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramAdapter } from './telegram';
import { S3Client } from '@aws-sdk/client-s3';

vi.mock('sst', () => ({
  Resource: {
    TelegramBotToken: { value: 'mock-token' },
    StagingBucket: { name: 'mock-bucket' },
  },
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;
  let mockS3: { send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockS3 = { send: vi.fn().mockResolvedValue({}) };
    adapter = new TelegramAdapter({
      s3: mockS3 as unknown as S3Client,
      token: 'test-token',
      bucketName: 'test-bucket',
    });
    global.fetch = vi.fn();
  });

  describe('parse', () => {
    it('should parse a valid telegram message', () => {
      const raw = {
        update_id: 12345,
        message: {
          chat: { id: 98765 },
          text: 'Hello world',
        },
      };

      const result = adapter.parse(raw);

      expect(result.source).toBe('telegram');
      expect(result.userId).toBe('98765');
      expect(result.sessionId).toBe('98765');
      expect(result.text).toBe('Hello world');
      expect(result.attachments).toEqual([]);
      expect(result.metadata.updateId).toBe(12345);
    });

    it('should throw on invalid raw input (schema validation failure)', () => {
      const raw = {
        message: {
          chat: { invalid: true },
        },
      };

      expect(() => adapter.parse(raw)).toThrow('Invalid Telegram update format');
    });

    it('should throw on completely malformed input', () => {
      expect(() => adapter.parse(null)).toThrow('Invalid Telegram update format');
      expect(() => adapter.parse('not an object')).toThrow('Invalid Telegram update format');
    });

    it('should parse with edited_message update (no message field)', () => {
      const raw = {
        update_id: 67890,
        edited_message: {
          chat: { id: 11111 },
          text: 'Edited text',
        },
      };

      const result = adapter.parse(raw);

      expect(result.source).toBe('telegram');
      expect(result.userId).toBe('non-message-update');
      expect(result.sessionId).toBe('non-message-update');
      expect(result.text).toBe('');
      expect(result.attachments).toEqual([]);
      expect(result.metadata.updateId).toBe(67890);
      expect(result.metadata.rawMessage).toBeUndefined();
    });

    it('should parse with callback_query update (no message field)', () => {
      const raw = {
        update_id: 99999,
        callback_query: {
          id: 'cb123',
          from: { id: 42 },
        },
      };

      const result = adapter.parse(raw);

      expect(result.userId).toBe('non-message-update');
      expect(result.text).toBe('');
      expect(result.metadata.rawMessage).toBeUndefined();
    });

    it('should parse message with caption', () => {
      const raw = {
        message: {
          chat: { id: 'user123' },
          caption: 'Photo caption',
          photo: [{ file_id: 'abc123' }],
        },
      };

      const result = adapter.parse(raw);

      expect(result.text).toBe('Photo caption');
      expect((result.metadata.rawMessage as Record<string, unknown>).photo).toBeDefined();
    });

    it('should return no-op for update with no fields', () => {
      const raw = { update_id: 12345 };
      const result = adapter.parse(raw);

      expect(result.userId).toBe('non-message-update');
      expect(result.text).toBe('');
      expect(result.metadata.updateId).toBe(12345);
      expect(result.metadata.rawMessage).toBeUndefined();
    });
  });

  describe('processMedia', () => {
    it('should return original message when no rawMessage in metadata', async () => {
      const message = {
        source: 'telegram' as const,
        userId: '123',
        sessionId: '123',
        text: 'Hello',
        attachments: [],
        metadata: {
          updateId: 1,
          rawMessage: undefined,
        },
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.processMedia(message);

      expect(result).toBe(message);
      expect(result.attachments).toEqual([]);
    });

    it('should process photo attachment', async () => {
      const mockFileBuffer = Buffer.from('fake-image-data');
      const mockFileInfo = {
        ok: true,
        result: { file_path: 'photos/file_123.jpg' },
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockFileInfo),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockFileBuffer.buffer),
        });

      const message = {
        source: 'telegram' as const,
        userId: '123',
        sessionId: '123',
        text: 'Check this photo',
        attachments: [],
        metadata: {
          updateId: 1,
          rawMessage: {
            chat: { id: '123' },
            caption: 'Check this photo',
            photo: [{ file_id: 'AgACAgIAAxkBAAIB' }],
          },
        },
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.processMedia(message);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token/getFile?file_id=AgACAgIAAxkBAAIB',
        expect.any(Object)
      );
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].type).toBe('image');
    });

    it('should process document attachment', async () => {
      const mockFileBuffer = Buffer.from('fake-document-data');
      const mockFileInfo = {
        ok: true,
        result: { file_path: 'documents/report.pdf' },
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockFileInfo),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockFileBuffer.buffer),
        });

      const message = {
        source: 'telegram' as const,
        userId: '123',
        sessionId: '123',
        text: 'Here is the doc',
        attachments: [],
        metadata: {
          updateId: 2,
          rawMessage: {
            chat: { id: '123' },
            text: 'Here is the doc',
            document: {
              file_id: 'BQACAgIAAxkBAAIC',
              file_name: 'report.pdf',
              mime_type: 'application/pdf',
            },
          },
        },
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.processMedia(message);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].type).toBe('file');
      expect(result.attachments[0].name).toBe('report.pdf');
      expect(result.attachments[0].mimeType).toBe('application/pdf');
    });

    it('should handle fetch failure for file info (catch block)', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const message = {
        source: 'telegram' as const,
        userId: '123',
        sessionId: '123',
        text: 'Photo here',
        attachments: [],
        metadata: {
          updateId: 3,
          rawMessage: {
            chat: { id: '123' },
            text: 'Photo here',
            photo: [{ file_id: 'fail_me' }],
          },
        },
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.processMedia(message);

      expect(result.attachments).toEqual([]);
    });

    it('should handle getFile returning ok: false', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: false,
            description: 'File is too big',
          }),
      });

      const message = {
        source: 'telegram' as const,
        userId: '123',
        sessionId: '123',
        text: 'Big photo',
        attachments: [],
        metadata: {
          updateId: 4,
          rawMessage: {
            chat: { id: '123' },
            photo: [{ file_id: 'big_file' }],
          },
        },
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.processMedia(message);

      expect(result.attachments).toEqual([]);
    });

    it('should handle download fetch failure', async () => {
      const mockFileInfo = {
        ok: true,
        result: { file_path: 'photos/big.jpg' },
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockFileInfo),
        })
        .mockRejectedValueOnce(new Error('Download failed'));

      const message = {
        source: 'telegram' as const,
        userId: '123',
        sessionId: '123',
        text: 'Download me',
        attachments: [],
        metadata: {
          updateId: 5,
          rawMessage: {
            chat: { id: '123' },
            photo: [{ file_id: 'download_fail' }],
          },
        },
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.processMedia(message);

      expect(result.attachments).toEqual([]);
    });

    it('should encode image as base64 for images < 5MB', async () => {
      const smallBuffer = Buffer.alloc(1024 * 1024);
      const mockFileInfo = {
        ok: true,
        result: { file_path: 'photos/small.jpg' },
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockFileInfo),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(smallBuffer.buffer),
        });

      const message = {
        source: 'telegram' as const,
        userId: '123',
        sessionId: '123',
        text: 'Small image',
        attachments: [],
        metadata: {
          updateId: 6,
          rawMessage: {
            chat: { id: '123' },
            photo: [{ file_id: 'small_img' }],
          },
        },
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.processMedia(message);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].base64).toBeDefined();
      expect(typeof result.attachments[0].base64).toBe('string');
    });

    it('should handle S3 upload failure', async () => {
      const mockFileBuffer = Buffer.from('image-data');
      const mockFileInfo = {
        ok: true,
        result: { file_path: 'photos/upload_fail.jpg' },
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockFileInfo),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockFileBuffer.buffer),
        });

      mockS3.send.mockRejectedValue(new Error('S3 upload failed'));

      const message = {
        source: 'telegram' as const,
        userId: '123',
        sessionId: '123',
        text: 'Upload me',
        attachments: [],
        metadata: {
          updateId: 7,
          rawMessage: {
            chat: { id: '123' },
            photo: [{ file_id: 's3_fail' }],
          },
        },
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.processMedia(message);

      expect(result.attachments).toEqual([]);
    });

    it('should process voice attachment', async () => {
      const mockFileBuffer = Buffer.from('voice-data');
      const mockFileInfo = {
        ok: true,
        result: { file_path: 'voice/file_123.ogg' },
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockFileInfo),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockFileBuffer.buffer),
        });

      const message = {
        source: 'telegram' as const,
        userId: '123',
        sessionId: '123',
        text: '',
        attachments: [],
        metadata: {
          updateId: 8,
          rawMessage: {
            chat: { id: '123' },
            voice: { file_id: 'voice_123' },
          },
        },
        timestamp: new Date().toISOString(),
      };

      const result = await adapter.processMedia(message);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].type).toBe('file');
      expect(result.attachments[0].name).toBe('voice.ogg');
      expect(result.attachments[0].mimeType).toBe('audio/ogg');
    });

    it('should use highest resolution photo when multiple photos provided', async () => {
      const mockFileBuffer = Buffer.from('high-res-photo');
      const mockFileInfo = {
        ok: true,
        result: { file_path: 'photos/highres.jpg' },
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockFileInfo),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockFileBuffer.buffer),
        });

      const message = {
        source: 'telegram' as const,
        userId: '123',
        sessionId: '123',
        text: 'Multi photo',
        attachments: [],
        metadata: {
          updateId: 9,
          rawMessage: {
            chat: { id: '123' },
            photo: [{ file_id: 'thumb' }, { file_id: 'medium' }, { file_id: 'highres' }],
          },
        },
        timestamp: new Date().toISOString(),
      };

      await adapter.processMedia(message);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('highres'),
        expect.any(Object)
      );
    });
  });

  describe('constructor', () => {
    it('should use explicit S3 client override', () => {
      const customS3 = new S3Client({ region: 'eu-west-1' });
      const testAdapter = new TelegramAdapter({
        s3: customS3,
        token: 'my-token',
        bucketName: 'my-bucket',
      });

      expect(testAdapter.source).toBe('telegram');
    });

    it('should use default SST resources when no options provided', () => {
      const testAdapter = new TelegramAdapter();

      expect(testAdapter.source).toBe('telegram');
    });
  });
});
