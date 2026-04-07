import { describe, it, expect, vi } from 'vitest';
import { InboundMessageSchema, AttachmentSchema, type InputAdapter } from './types';
import { AttachmentType } from '../../lib/types/llm';

describe('AttachmentSchema', () => {
  it('validates a complete attachment', () => {
    const input = {
      type: AttachmentType.IMAGE,
      url: 'https://example.com/image.png',
      name: 'image.png',
      mimeType: 'image/png',
    };

    const result = AttachmentSchema.parse(input);

    expect(result).toEqual(input);
  });

  it('validates attachment with base64', () => {
    const input = {
      type: AttachmentType.IMAGE,
      base64: 'data:image/png;base64,abc123',
      name: 'image.png',
    };

    const result = AttachmentSchema.parse(input);

    expect(result.type).toBe(AttachmentType.IMAGE);
    expect(result.base64).toBe('data:image/png;base64,abc123');
  });

  it('rejects minimal attachment with only type', () => {
    const input = {
      type: AttachmentType.FILE,
    };

    expect(() => AttachmentSchema.parse(input)).toThrow();
  });

  it('rejects invalid URL', () => {
    const input = {
      type: AttachmentType.IMAGE,
      url: 'not-a-url',
    };

    expect(() => AttachmentSchema.parse(input)).toThrow();
  });

  it('accepts all attachment types', () => {
    const types = [AttachmentType.IMAGE, AttachmentType.FILE];

    for (const type of types) {
      const input = { type, url: 'https://example.com/file.bin' };
      const result = AttachmentSchema.parse(input);
      expect(result.type).toBe(type);
    }
  });
});

describe('InboundMessageSchema', () => {
  it('validates a complete inbound message', () => {
    const input = {
      source: 'telegram',
      userId: 'user123',
      sessionId: 'session456',
      text: 'Hello world',
      attachments: [{ type: AttachmentType.IMAGE, url: 'https://example.com/img.png' }],
      metadata: { key: 'value' },
      timestamp: '2026-01-01T00:00:00Z',
    };

    const result = InboundMessageSchema.parse(input);

    expect(result).toEqual(input);
  });

  it('validates a minimal inbound message (defaults applied)', () => {
    const input = {
      source: 'github',
      userId: 'user123',
      sessionId: 'session456',
      text: 'Hello',
    };

    const result = InboundMessageSchema.parse(input);

    expect(result.attachments).toEqual([]);
    expect(result.metadata).toEqual({});
    expect(result.timestamp).toBeUndefined();
  });

  it('rejects missing required fields', () => {
    expect(() =>
      InboundMessageSchema.parse({ userId: 'user123', sessionId: 'session456', text: 'Hello' })
    ).toThrow();
    expect(() =>
      InboundMessageSchema.parse({ source: 'test', sessionId: 'session456', text: 'Hello' })
    ).toThrow();
    expect(() =>
      InboundMessageSchema.parse({ source: 'test', userId: 'user123', text: 'Hello' })
    ).toThrow();
    expect(() =>
      InboundMessageSchema.parse({ source: 'test', userId: 'user123', sessionId: 'session456' })
    ).toThrow();
  });

  it('accepts metadata with various value types', () => {
    const input = {
      source: 'test',
      userId: 'user123',
      sessionId: 'session456',
      text: 'Hello',
      metadata: {
        str: 'value',
        num: 42,
        bool: true,
        arr: [1, 2, 3],
      },
    };

    const result = InboundMessageSchema.parse(input);

    expect(result.metadata).toEqual(input.metadata);
  });

  it('accepts multiple attachments', () => {
    const input = {
      source: 'test',
      userId: 'user123',
      sessionId: 'session456',
      text: 'Hello',
      attachments: [
        { type: AttachmentType.IMAGE, url: 'https://example.com/img1.png' },
        { type: AttachmentType.FILE, url: 'https://example.com/doc.pdf' },
      ],
    };

    const result = InboundMessageSchema.parse(input);

    expect(result.attachments).toHaveLength(2);
  });
});

describe('InputAdapter interface', () => {
  it('can be implemented by a mock adapter', () => {
    const mockParse = vi.fn().mockReturnValue({
      source: 'test',
      userId: 'user123',
      sessionId: 'session456',
      text: 'Hello',
      attachments: [],
      metadata: {},
    });

    const mockAdapter: InputAdapter = {
      source: 'test',
      parse: mockParse,
    };

    const result = mockAdapter.parse({ raw: 'data' });

    expect(mockParse).toHaveBeenCalledWith({ raw: 'data' });
    expect(result.source).toBe('test');
  });

  it('processMedia is optional', () => {
    const mockAdapter: InputAdapter = {
      source: 'test',
      parse: () => ({
        source: 'test',
        userId: 'user123',
        sessionId: 'session456',
        text: 'Hello',
        attachments: [],
        metadata: {},
      }),
    };

    expect(mockAdapter.processMedia).toBeUndefined();
  });

  it('can implement processMedia', async () => {
    const mockProcessMedia = vi.fn().mockImplementation(async (msg) => ({
      ...msg,
      metadata: { ...msg.metadata, processed: true },
    }));

    const mockAdapter: InputAdapter = {
      source: 'test',
      parse: () => ({
        source: 'test',
        userId: 'user123',
        sessionId: 'session456',
        text: 'Hello',
        attachments: [],
        metadata: {},
      }),
      processMedia: mockProcessMedia,
    };

    const message = mockAdapter.parse({});
    const processed = await mockAdapter.processMedia!(message);

    expect(mockProcessMedia).toHaveBeenCalledWith(message);
    expect(processed.metadata.processed).toBe(true);
  });
});
