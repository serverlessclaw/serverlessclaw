import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('./shared', () => ({
  getRecursionLimit: vi.fn(async () => 10),
  handleRecursionLimitExceeded: vi.fn(),
  wakeupInitiator: vi.fn(),
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../lib/memory/base', () => ({
  BaseMemoryProvider: class {},
}));

vi.mock('../../lib/memory/reputation-operations', () => ({
  updateReputation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/agent/parallel-aggregator', () => ({
  aggregator: {
    getState: vi.fn().mockResolvedValue(null),
    addResult: vi.fn().mockResolvedValue(null),
    updateDagState: vi.fn().mockResolvedValue(true),
    markAsCompleted: vi.fn().mockResolvedValue(true),
  },
}));

import { handleTaskResult } from './task-result-handler';
import * as shared from './shared';
import { EventType } from '../../lib/types';

describe('task-result-handler.unit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wakes the initiator on non-parallel completion', async () => {
    const event = {
      userId: 'user-1',
      agentId: 'agent-A',
      task: 'do work',
      response: 'all good',
      initiatorId: 'agent-B',
      depth: 1,
      sessionId: 's1',
    };

    await handleTaskResult(event as any, EventType.TASK_COMPLETED);

    expect(shared.wakeupInitiator as any).toHaveBeenCalledTimes(1);
    expect(shared.wakeupInitiator as any).toHaveBeenCalledWith(
      'user-1',
      'agent-B',
      expect.stringContaining('DELEGATED_TASK_RESULT'),
      expect.any(String),
      's1',
      1,
      false
    );
  });

  it('calls handleRecursionLimitExceeded when depth exceeds limit', async () => {
    (shared.getRecursionLimit as any).mockResolvedValueOnce(0);

    const event = {
      userId: 'user-2',
      agentId: 'agent-X',
      task: 'loop',
      response: 'n/a',
      initiatorId: 'agent-Y',
      depth: 0,
      sessionId: 's2',
    };

    await handleTaskResult(event as any, EventType.TASK_COMPLETED);

    expect(shared.handleRecursionLimitExceeded as any).toHaveBeenCalledTimes(1);
    expect(shared.wakeupInitiator as any).not.toHaveBeenCalled();
  });
});
