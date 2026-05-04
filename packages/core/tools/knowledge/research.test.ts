import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestResearch } from './research';
import { emitEvent } from '../../lib/utils/bus';

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/tracer', () => {
  const mockChildTracer = {
    getTraceId: () => 'child-trace-id',
    getNodeId: () => 'child-node-id',
    getParentId: () => 'parent-id',
  };
  return {
    ClawTracer: class {
      getChildTracer = vi.fn().mockReturnValue(mockChildTracer);
    },
  };
});

describe('Research Tool', () => {
  const args = {
    goal: 'Test research goal',
    userId: 'user-123',
    traceId: 'trace-456',
    nodeId: 'node-789',
    sessionId: 'session-abc',
    initiatorId: 'agent-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully dispatch a research mission and return TASK_PAUSED', async () => {
    const result = await requestResearch.execute(args);

    expect(result).toContain('TASK_PAUSED');
    expect(result).toContain('Test research goal');

    expect(emitEvent).toHaveBeenCalledWith(
      'agent-1',
      'research_task',
      expect.objectContaining({
        userId: 'user-123',
        task: 'Test research goal',
        traceId: 'child-trace-id',
        sessionId: 'session-abc',
      })
    );
  });

  it('should handle errors gracefully', async () => {
    (emitEvent as any).mockRejectedValueOnce(new Error('Network error'));

    const result = await requestResearch.execute(args);

    expect(result).toContain('Failed to initiate research delegation');
    expect(result).toContain('Network error');
  });
});
