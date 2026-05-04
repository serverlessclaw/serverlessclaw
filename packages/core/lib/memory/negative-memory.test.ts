import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NegativeMemory } from './negative-memory';
// Removed unused BaseMemoryProvider

vi.mock('./base', () => {
  class MockBaseMemoryProvider {
    getScopedUserId = vi.fn((pk) => pk);
    putItem = vi.fn().mockResolvedValue({});
    queryItems = vi.fn().mockResolvedValue([]);
  }
  return { BaseMemoryProvider: MockBaseMemoryProvider };
});

describe('NegativeMemory', () => {
  let negMemory: NegativeMemory;
  let mockBase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    negMemory = new NegativeMemory();
    mockBase = (negMemory as any).base;
  });

  it('records a failure correctly', async () => {
    await negMemory.recordFailure('agent_1', 'task_1', 'plan_1', 'reason_1');

    expect(mockBase.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent_1',
        task: 'task_1',
        failureReason: 'reason_1',
        type: 'FAILED_PLAN',
      })
    );
  });

  it('retrieves negative context', async () => {
    mockBase.queryItems.mockResolvedValue([
      {
        task: 'task_1',
        failureReason: 'reason_1',
        plan: 'plan_1',
      },
    ]);

    const context = await negMemory.getNegativeContext('agent_1');
    expect(context).toContain('NEGATIVE CONTEXT');
    expect(context).toContain('task_1');
    expect(context).toContain('reason_1');
  });
});
