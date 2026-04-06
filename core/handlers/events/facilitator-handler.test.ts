import { describe, it, expect, vi } from 'vitest';

// Mock the facilitator agent handler
vi.mock('../../agents/facilitator', () => ({
  handler: vi.fn().mockResolvedValue({}),
}));

import { handleFacilitatorTask } from './facilitator-handler';
import { handler as facilitatorHandler } from '../../agents/facilitator';

describe('handleFacilitatorTask', () => {
  it('parses event and calls facilitator handler with correct detail', async () => {
    const event = {
      userId: 'user-1',
      task: 'do something',
      traceId: 'trace-1',
      sessionId: 'sess-1',
      initiatorId: 'initiator-1',
      attachments: [],
    };
    const context = { functionName: 'test-lambda' };

    await handleFacilitatorTask(event as any, context as any);

    expect(facilitatorHandler).toHaveBeenCalled();
    const args = (facilitatorHandler as any).mock.calls[0];
    expect(args[0]).toMatchObject({
      detail: event,
      source: 'agent.facilitator',
    });
    expect(args[1]).toBe(context);
  });
});
