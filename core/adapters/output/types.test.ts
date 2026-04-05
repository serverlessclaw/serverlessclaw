import { describe, it, expect, vi } from 'vitest';
import { OutboundMessageSchema, type OutputAdapter } from './types';

describe('OutboundMessageSchema', () => {
  it('validates a complete outbound message', () => {
    const input = {
      source: 'test',
      userId: 'user123',
      sessionId: 'session456',
      text: 'Hello world',
      platform: 'telegram' as const,
      metadata: { key: 'value' },
      timestamp: '2026-01-01T00:00:00Z',
    };

    const result = OutboundMessageSchema.parse(input);

    expect(result).toEqual(input);
  });

  it('validates a minimal outbound message (metadata defaults to {})', () => {
    const input = {
      source: 'test',
      userId: 'user123',
      sessionId: 'session456',
      text: 'Hello',
      platform: 'slack' as const,
    };

    const result = OutboundMessageSchema.parse(input);

    expect(result.metadata).toEqual({});
    expect(result.timestamp).toBeUndefined();
  });

  it('rejects invalid platform values', () => {
    const input = {
      source: 'test',
      userId: 'user123',
      sessionId: 'session456',
      text: 'Hello',
      platform: 'invalid_platform',
    };

    expect(() => OutboundMessageSchema.parse(input)).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() =>
      OutboundMessageSchema.parse({
        userId: 'user123',
        sessionId: 'session456',
        text: 'Hello',
        platform: 'telegram',
      })
    ).toThrow();
    expect(() =>
      OutboundMessageSchema.parse({
        source: 'test',
        sessionId: 'session456',
        text: 'Hello',
        platform: 'telegram',
      })
    ).toThrow();
    expect(() =>
      OutboundMessageSchema.parse({
        source: 'test',
        userId: 'user123',
        text: 'Hello',
        platform: 'telegram',
      })
    ).toThrow();
    expect(() =>
      OutboundMessageSchema.parse({
        source: 'test',
        userId: 'user123',
        sessionId: 'session456',
        platform: 'telegram',
      })
    ).toThrow();
  });

  it('accepts all valid platform values', () => {
    const platforms = ['telegram', 'discord', 'slack', 'github', 'jira', 'generic'] as const;

    for (const platform of platforms) {
      const input = {
        source: 'test',
        userId: 'user123',
        sessionId: 'session456',
        text: 'Hello',
        platform,
      };

      const result = OutboundMessageSchema.parse(input);
      expect(result.platform).toBe(platform);
    }
  });

  it('accepts metadata with various value types', () => {
    const input = {
      source: 'test',
      userId: 'user123',
      sessionId: 'session456',
      text: 'Hello',
      platform: 'telegram' as const,
      metadata: {
        str: 'value',
        num: 42,
        bool: true,
        arr: [1, 2, 3],
      },
    };

    const result = OutboundMessageSchema.parse(input);

    expect(result.metadata).toEqual(input.metadata);
  });
});

describe('OutputAdapter interface', () => {
  it('can be implemented by a mock adapter', async () => {
    const mockSend = vi.fn().mockResolvedValue(undefined);

    const mockAdapter: OutputAdapter = {
      platform: 'test',
      send: mockSend,
    };

    const message = OutboundMessageSchema.parse({
      source: 'test',
      userId: 'user123',
      sessionId: 'session456',
      text: 'Hello',
      platform: 'telegram' as const,
    });

    await mockAdapter.send(message);

    expect(mockSend).toHaveBeenCalledWith(message);
  });
});
