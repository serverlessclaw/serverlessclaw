import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from './merger';
import { AgentType, EventType } from '../lib/types/agent';
import { initAgent } from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';

// Mock dependencies
vi.mock('../lib/utils/agent-helpers', () => ({
  initAgent: vi.fn(),
  extractPayload: vi.fn((e) => e.detail),
  validatePayload: vi.fn(() => true),
}));

vi.mock('../lib/utils/agent-helpers/event-emitter', () => ({
  emitTaskEvent: vi.fn(),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('Merger Agent Handler', () => {
  const mockAgent = {
    process: vi.fn().mockResolvedValue({
      responseText: JSON.stringify({ status: 'SUCCESS', response: 'Merged successfully' }),
      attachments: [],
    }),
  };

  const mockMemory = {};
  const mockConfig = { id: AgentType.MERGER, name: 'Structural Merger' };

  beforeEach(() => {
    vi.clearAllMocks();
    (initAgent as any).mockResolvedValue({ agent: mockAgent, memory: mockMemory, config: mockConfig });
  });

  it('should process parallel patches and emit a completion event', async () => {
    const event = {
      'detail-type': EventType.PARALLEL_TASK_COMPLETED,
      detail: {
        userId: 'user-1',
        task: 'Implement authentication',
        traceId: 'trace-1',
        sessionId: 'session-1',
        initiatorId: 'planner-1',
        depth: 1,
        metadata: {
          patches: [
            { coderId: 'coder-1', patch: 'diff-1' },
            { coderId: 'coder-2', patch: 'diff-2' },
          ],
        },
      },
    };

    const result = await handler(event as any, {} as any);

    expect(initAgent).toHaveBeenCalledWith(AgentType.MERGER);
    expect(mockAgent.process).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('Merge the following patches'),
      expect.objectContaining({
        traceId: 'trace-1',
        sessionId: 'session-1',
      })
    );

    expect(emitTaskEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: AgentType.MERGER,
      agentId: AgentType.MERGER,
      response: expect.stringContaining('Merged successfully'),
    }));

    expect(result).toContain('Merged successfully');
  });
});
