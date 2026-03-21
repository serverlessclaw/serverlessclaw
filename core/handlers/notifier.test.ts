import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAddMessage } = vi.hoisted(() => ({
  mockAddMessage: vi.fn().mockResolvedValue(true),
}));

// Mock sst Resource BEFORE other imports
vi.mock('sst', () => ({
  Resource: {
    TelegramBotToken: { value: 'mock-token' },
  },
}));

// Mock dependencies
vi.mock('../lib/memory', () => ({
  DynamoMemory: vi.fn().mockImplementation(function () {
    return {
      addMessage: mockAddMessage,
    };
  }),
}));

import { handler } from './notifier';

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock global fetch
global.fetch = vi.fn();

describe('Notifier Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddMessage.mockResolvedValue(true);
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

  it('should sync multiple contexts correctly without double-prefixing', async () => {
    const event = {
      detail: {
        userId: 'user123',
        message: 'Shared update',
        sessionId: 'sessionABC',
      },
    } as any;

    await handler(event);

    // Should sync to:
    // 1. Base user: user123
    // 2. Session context: CONV#user123#sessionABC
    expect(mockAddMessage).toHaveBeenCalledTimes(2);
    expect(mockAddMessage).toHaveBeenCalledWith('user123', expect.any(Object));
    expect(mockAddMessage).toHaveBeenCalledWith('CONV#user123#sessionABC', expect.any(Object));
  });

  it('should be resilient to already-prefixed userId strings (normalization)', async () => {
    const event = {
      detail: {
        userId: 'CONV#dashboard-user#session_123',
        message: 'Resilient update',
        sessionId: 'session_123',
      },
    } as any;

    await handler(event);

    // Should detect the prefix and normalize to:
    // 1. Base user: dashboard-user
    // 2. Session context: CONV#dashboard-user#session_123
    // It should NOT sync to CONV#CONV#dashboard-user#session_123#session_123

    expect(mockAddMessage).toHaveBeenCalledWith('dashboard-user', expect.any(Object));
    expect(mockAddMessage).toHaveBeenCalledWith(
      'CONV#dashboard-user#session_123',
      expect.any(Object)
    );

    // Check that we don't have the double-prefixed one
    const syncCalls = mockAddMessage.mock.calls.map((c) => c[0]);
    expect(syncCalls).not.toContain('CONV#CONV#dashboard-user#session_123#session_123');
  });
});
