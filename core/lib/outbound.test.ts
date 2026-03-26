import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
  EventPriority: { HIGH: 'high', NORMAL: 'normal', LOW: 'low' },
}));

vi.mock('./types/agent', () => ({
  EventType: { OUTBOUND_MESSAGE: 'outbound_message' },
}));

vi.mock('./utils/agent-helpers', () => ({
  extractBaseUserId: vi.fn((id: string) => id.replace('CONV#', '')),
}));

import { sendOutboundMessage } from './outbound';
import { emitEvent, EventPriority } from './utils/bus';
import { EventType } from './types/agent';

describe('sendOutboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should emit an outbound message event', async () => {
    await sendOutboundMessage('test.source', 'user123', 'Hello world');
    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith(
      'test.source',
      EventType.OUTBOUND_MESSAGE,
      expect.objectContaining({
        userId: 'user123',
        message: 'Hello world',
      }),
      expect.objectContaining({ priority: EventPriority.HIGH })
    );
  });

  it('should normalize userId by stripping CONV# prefix', async () => {
    await sendOutboundMessage('test.source', 'CONV#user456', 'Hi');
    expect(emitEvent).toHaveBeenCalledWith(
      'test.source',
      EventType.OUTBOUND_MESSAGE,
      expect.objectContaining({ userId: 'user456' }),
      expect.anything()
    );
  });

  it('should include memoryContexts defaulting to baseUserId', async () => {
    await sendOutboundMessage('test.source', 'user789', 'Test');
    expect(emitEvent).toHaveBeenCalledWith(
      'test.source',
      EventType.OUTBOUND_MESSAGE,
      expect.objectContaining({ memoryContexts: ['user789'] }),
      expect.anything()
    );
  });

  it('should include optional parameters when provided', async () => {
    await sendOutboundMessage(
      'test.source',
      'user1',
      'msg',
      ['ctx1'],
      'session1',
      'agent1',
      [{ type: 'image', url: 'https://example.com/img.png' } as any],
      'msg-id-1'
    );
    expect(emitEvent).toHaveBeenCalledWith(
      'test.source',
      EventType.OUTBOUND_MESSAGE,
      expect.objectContaining({
        memoryContexts: ['ctx1'],
        sessionId: 'session1',
        agentName: 'agent1',
        messageId: 'msg-id-1',
      }),
      expect.anything()
    );
  });

  it('should include options when provided', async () => {
    const options = [{ label: 'Yes', value: 'yes', type: 'primary' as const }];
    await sendOutboundMessage(
      'test.source',
      'user1',
      'Choose',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      options
    );
    expect(emitEvent).toHaveBeenCalledWith(
      'test.source',
      EventType.OUTBOUND_MESSAGE,
      expect.objectContaining({ options }),
      expect.anything()
    );
  });
});
