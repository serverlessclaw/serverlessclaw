import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendOutboundMessage } from './outbound';
import * as bus from './utils/bus';

vi.mock('./utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('sendOutboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send an outbound message with required parameters', async () => {
    const mockEmitEvent = vi.mocked(bus.emitEvent);

    await sendOutboundMessage('webhook.handler', 'user-123', 'Hello world');

    expect(mockEmitEvent).toHaveBeenCalledWith('webhook.handler', 'outbound_message', {
      userId: 'user-123',
      message: 'Hello world',
      memoryContexts: undefined,
      sessionId: undefined,
      agentName: undefined,
      attachments: undefined,
    });
  });

  it('should send an outbound message with all optional parameters', async () => {
    const mockEmitEvent = vi.mocked(bus.emitEvent);
    const attachments = [{ name: 'file.txt', type: 'text/plain', content: 'data' }];

    await sendOutboundMessage(
      'agent.handler',
      'user-456',
      'Test message',
      ['context-1', 'context-2'],
      'session-789',
      'test-agent',
      attachments as any
    );

    expect(mockEmitEvent).toHaveBeenCalledWith('agent.handler', 'outbound_message', {
      userId: 'user-456',
      message: 'Test message',
      memoryContexts: ['context-1', 'context-2'],
      sessionId: 'session-789',
      agentName: 'test-agent',
      attachments: attachments,
    });
  });

  it('should return a resolved promise', async () => {
    const result = await sendOutboundMessage('handler', 'user', 'message');
    expect(result).toBeUndefined();
  });
});
