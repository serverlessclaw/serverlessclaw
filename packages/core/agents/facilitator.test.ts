import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './facilitator';
import { AGENT_TYPES, EventType } from '../lib/types/agent';
import { processEventWithAgent } from '../handlers/events/shared';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../handlers/events/shared', () => ({
  processEventWithAgent: vi.fn().mockResolvedValue({
    responseText: 'Facilitator Decision: Proceed with Plan A.',
    attachments: [],
  }),
}));

vi.mock('../lib/utils/agent-helpers/event-emitter', () => ({
  emitTaskEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('Facilitator Agent', () => {
  const mockContext = { awsRequestId: 'request-123' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle a STRATEGIC_TIE_BREAK event', async () => {
    const event = {
      'detail-type': EventType.STRATEGIC_TIE_BREAK,
      detail: {
        userId: 'system_tiebreak',
        agentId: 'facilitator',
        task: 'Conflict resolution required for Collab-123',
        traceId: 'trace-456',
        sessionId: 'session-789',
        metadata: {
          collaborationId: 'collab-123',
          timeout: true,
        },
      },
    } as any;

    const result = await handler(event, mockContext);

    expect(result).toBe('Facilitator Decision: Proceed with Plan A.');
    expect(processEventWithAgent).toHaveBeenCalledWith(
      'system_tiebreak',
      AGENT_TYPES.FACILITATOR,
      'Conflict resolution required for Collab-123',
      expect.objectContaining({
        traceId: 'trace-456',
        sessionId: 'session-789',
        handlerTitle: 'FACILITATOR_TASK',
      })
    );
  });

  it('should emit a task failure event if processing fails', async () => {
    vi.mocked(processEventWithAgent).mockRejectedValueOnce(new Error('LLM Timeout'));

    const event = {
      detail: {
        userId: 'user-1',
        task: 'facilitate consensus',
        traceId: 't-1',
      },
    } as any;

    await expect(handler(event, mockContext)).rejects.toThrow('LLM Timeout');

    expect(emitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AGENT_TYPES.FACILITATOR,
        error: expect.stringContaining('LLM Timeout'),
      })
    );
  });
});
