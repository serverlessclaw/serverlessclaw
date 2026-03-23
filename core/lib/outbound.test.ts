import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendOutboundMessage } from './outbound';
import { emitEvent } from './utils/bus';
import { Attachment } from './types/index';

vi.mock('./utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue({ success: true, eventId: 'test-id' }),
  EventPriority: {
    CRITICAL: 'CRITICAL',
    HIGH: 'HIGH',
    NORMAL: 'NORMAL',
    LOW: 'LOW',
  },
}));

describe('sendOutboundMessage', () => {
  const mockEmitEvent = vi.mocked(emitEvent);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send an outbound message with basic parameters', async () => {
    const userId = 'CONV#dashboard-user#session_123';
    const message = 'Hello world';

    await sendOutboundMessage('webhook.handler', userId, message);

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'webhook.handler',
      'outbound_message',
      expect.objectContaining({
        userId: 'CONV#dashboard-user#session_123',
        message: 'Hello world',
        memoryContexts: ['dashboard-user'],
      }),
      { priority: 'HIGH' }
    );
  });

  it('should send an outbound message with all optional parameters', async () => {
    const source = 'agent.handler';
    const userId = 'user-456';
    const message = 'Test message';
    const memoryContexts = ['context-1', 'context-2'];
    const sessionId = 'session-789';
    const agentName = 'test-agent';
    const attachments = [{ type: 'image', url: 'http://example.com/img.png' }];

    await sendOutboundMessage(
      source,
      userId,
      message,
      memoryContexts,
      sessionId,
      agentName,
      attachments as Attachment[]
    );

    expect(mockEmitEvent).toHaveBeenCalledWith(
      'agent.handler',
      'outbound_message',
      expect.objectContaining({
        userId: 'user-456',
        message: 'Test message',
        memoryContexts,
        sessionId,
        agentName,
        attachments,
      }),
      { priority: 'HIGH' }
    );
  });
});
