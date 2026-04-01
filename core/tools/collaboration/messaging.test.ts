import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./schema', () => ({
  collaborationSchema: {
    sendMessage: {
      name: 'sendMessage',
      description: 'Sends a direct message.',
      parameters: {},
    },
    broadcastMessage: {
      name: 'broadcastMessage',
      description: 'Broadcasts a message.',
      parameters: {},
    },
  },
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/utils/error', () => ({
  formatErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../lib/types/index', () => ({
  EventType: { CONTINUATION_TASK: 'continuation_task' },
}));

vi.mock('../../lib/types/constants', () => ({
  TraceType: { COLLABORATION_STARTED: 'collaboration_started' },
}));

const mockEmitEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/utils/bus', () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}));

import { sendMessage, broadcastMessage } from './messaging';
import { sendOutboundMessage } from '../../lib/outbound';

describe('sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct tool definition', () => {
    expect(sendMessage.name).toBe('sendMessage');
    expect(sendMessage.description).toBeDefined();
    expect(sendMessage.parameters).toBeDefined();
  });

  it('sends a direct message successfully', async () => {
    const result = await sendMessage.execute({
      message: 'Hello user',
      userId: 'user-123',
    });

    expect(result).toBe('Message sent successfully to user.');
    expect(sendOutboundMessage).toHaveBeenCalledWith(
      'tool.sendMessage',
      'user-123',
      'Hello user',
      ['user-123'],
      undefined,
      undefined,
      undefined,
      undefined
    );
  });

  it('passes sessionId and agentName when provided', async () => {
    await sendMessage.execute({
      message: 'hi',
      userId: 'user-1',
      sessionId: 'sess-abc',
      agentName: 'coder',
      traceId: 'trace-xyz',
    });

    expect(sendOutboundMessage).toHaveBeenCalledWith(
      'tool.sendMessage',
      'user-1',
      'hi',
      ['user-1'],
      'sess-abc',
      'coder',
      undefined,
      'trace-xyz'
    );
  });

  it('returns failure message when send fails', async () => {
    vi.mocked(sendOutboundMessage).mockRejectedValueOnce(new Error('Network error'));

    const result = await sendMessage.execute({
      message: 'fail',
      userId: 'user-1',
    });

    expect(result).toContain('Failed to send message');
    expect(result).toContain('Network error');
  });

  it('handles non-Error exceptions', async () => {
    vi.mocked(sendOutboundMessage).mockRejectedValueOnce('timeout');

    const result = await sendMessage.execute({
      message: 'fail',
      userId: 'user-1',
    });

    expect(result).toContain('Failed to send message');
  });
});

describe('broadcastMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct tool definition', () => {
    expect(broadcastMessage.name).toBe('broadcastMessage');
    expect(broadcastMessage.description).toBeDefined();
    expect(broadcastMessage.parameters).toBeDefined();
  });

  it('broadcasts a message successfully', async () => {
    const result = await broadcastMessage.execute({
      message: 'System update',
    });

    expect(result).toContain('Broadcast message sent');
    expect(result).toContain('System update');
    expect(mockEmitEvent).toHaveBeenCalledWith(
      'system.broadcast',
      'broadcast_message',
      expect.objectContaining({
        message: 'System update',
        category: 'general',
      })
    );
  });

  it('uses provided category', async () => {
    await broadcastMessage.execute({
      message: 'urgent',
      category: 'alert',
    });

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'system.broadcast',
      'broadcast_message',
      expect.objectContaining({
        category: 'alert',
      })
    );
  });

  it('defaults category to general when not provided', async () => {
    await broadcastMessage.execute({ message: 'test' });

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'system.broadcast',
      'broadcast_message',
      expect.objectContaining({ category: 'general' })
    );
  });

  it('includes timestamp in broadcast event', async () => {
    await broadcastMessage.execute({ message: 'ts test' });

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'system.broadcast',
      'broadcast_message',
      expect.objectContaining({
        timestamp: expect.any(Number),
      })
    );
  });

  it('returns failure message when broadcast fails', async () => {
    mockEmitEvent.mockRejectedValueOnce(new Error('Bus unavailable'));

    const result = await broadcastMessage.execute({ message: 'fail' });

    expect(result).toContain('Failed to broadcast message');
    expect(result).toContain('Bus unavailable');
  });

  it('handles non-Error exceptions in broadcast', async () => {
    mockEmitEvent.mockRejectedValueOnce('some string error');

    const result = await broadcastMessage.execute({ message: 'fail' });

    expect(result).toContain('Failed to broadcast message');
  });
});
