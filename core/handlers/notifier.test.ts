import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sst Resource BEFORE other imports
vi.mock('sst', () => ({
  Resource: {
    TelegramBotToken: { value: 'mock-token' },
  },
}));

import { handler } from './notifier';

// Mock dependencies
vi.mock('../lib/memory', () => ({
  DynamoMemory: class {
    addMessage = vi.fn().mockResolvedValue(true);
  },
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock global fetch
global.fetch = vi.fn();

describe('Notifier Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send simple text message', async () => {
    const event = {
      detail: {
        userId: '123456789',
        message: 'Hello user',
      },
    } as any;

    (global.fetch as any).mockResolvedValue({ ok: true });

    await handler(event);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/sendMessage'),
      expect.objectContaining({
        body: expect.stringContaining('"text":"Hello user"'),
      })
    );
  });
});
