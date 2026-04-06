import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sst Resource BEFORE other imports
vi.mock('sst', () => ({
  Resource: {
    TelegramBotToken: { value: 'tg-token' },
    DiscordBotToken: { value: 'ds-token' },
    SlackBotToken: { value: 'sl-token' },
  },
}));

vi.mock('../lib/memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function () {
    return {
      addMessage: vi.fn().mockResolvedValue(true),
    };
  }),
}));

import { handler } from './notifier';

// Mock global fetch
global.fetch = vi.fn();

describe('Notifier Remediation Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('A.4 Notifier HTML Escaping', () => {
    it('should escape double and single quotes in Telegram messages', async () => {
      const event = {
        detail: {
          userId: '123456789',
          message: 'Hello "World" and \'Gemini\' & others < >',
        },
      } as any;

      (global.fetch as any).mockResolvedValue({ ok: true });

      await handler(event);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.telegram.org/bottg-token/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining(
            'Hello &quot;World&quot; and &#039;Gemini&#039; &amp; others &lt; &gt;'
          ),
        })
      );
    });
  });

  describe('A.3 Notifier HTTP Checks', () => {
    it('should throw error on 429 (rate limit)', async () => {
      const event = {
        detail: {
          userId: '123456789',
          message: 'Too many messages',
        },
      } as any;

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      });

      await expect(handler(event)).rejects.toThrow(
        '[NOTIFIER] Telegram API error (429): Rate limit exceeded'
      );
    });

    it('should throw error on 401 (auth failure)', async () => {
      const event = {
        detail: {
          userId: '123456789',
          message: 'Invalid token',
        },
      } as any;

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(handler(event)).rejects.toThrow(
        '[NOTIFIER] Telegram API error (401): Unauthorized'
      );
    });

    it('should throw error on 500 (server error)', async () => {
      const event = {
        detail: {
          userId: '123456789',
          message: 'Server error',
        },
      } as any;

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(handler(event)).rejects.toThrow(
        '[NOTIFIER] Telegram API error (500): Internal Server Error'
      );
    });

    it('should NOT throw error but log on 400 (bad request)', async () => {
      const event = {
        detail: {
          userId: '123456789',
          message: 'Bad request',
        },
      } as any;

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      });

      // It should NOT throw
      await expect(handler(event)).resolves.not.toThrow();
    });
  });
});
