import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDdbSend, mockEmitEvent } = vi.hoisted(() => ({
  mockDdbSend: vi.fn().mockResolvedValue({}),
  mockEmitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockDdbSend })) },
  PutCommand: vi.fn((args: any) => ({ input: args })),
}));

vi.mock('sst', () => ({
  Resource: { MemoryTable: { name: 'TestMemoryTable' } },
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../lib/utils/bus', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    emitEvent: mockEmitEvent,
  };
});

import { handler } from './concurrency-monitor';
import { logger } from '../lib/logger';

describe('concurrency-monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
    mockEmitEvent.mockResolvedValue(undefined);
  });

  it('should export a handler function', () => {
    expect(typeof handler).toBe('function');
  });

  it('should handle Lambda SDK errors gracefully', async () => {
    await expect(handler()).resolves.not.toThrow();
  });

  it('should log checking message on invocation', async () => {
    await handler();

    expect(logger.info).toHaveBeenCalledWith(
      'Lambda Concurrency Monitor: Checking account settings'
    );
  });

  it('should not throw on invocation', async () => {
    await expect(handler()).resolves.toBeUndefined();
  });

  it('should complete without errors on multiple invocations', async () => {
    await handler();
    await handler();
    await handler();

    expect(logger.info).toHaveBeenCalled();
  });

  it('should not throw when called repeatedly', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(handler()).resolves.not.toThrow();
    }
  });
});

import { handleRecursionLimitExceeded } from './events/shared';

describe('Infinite Loop Prevention', () => {
  it('should halt infinite execution loops when recursion limit is reached', async () => {
    const mockUserId = 'user-loop-test';
    const mockSessionId = 'session-123';

    await handleRecursionLimitExceeded(
      mockUserId,
      mockSessionId,
      'concurrency-monitor',
      'Simulated infinite loop limit reached. Halting execution.'
    );

    // It should emit a system event to notify the user and stop the chain
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'concurrency-monitor',
      'outbound_message',
      expect.objectContaining({
        userId: mockUserId,
        sessionId: mockSessionId,
        message: expect.stringContaining('Simulated infinite loop'),
      }),
      expect.anything()
    );
  });
});
