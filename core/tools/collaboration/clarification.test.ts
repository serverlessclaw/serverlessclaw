import { vi, describe, it, expect, beforeEach } from 'vitest';
import { seekClarification, provideClarification } from './clarification';
import { emitEvent } from '../../lib/utils/bus';

// Mock dependencies
vi.mock('../../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('Clarification Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('seekClarification', () => {
    it('should return TASK_PAUSED signal upon successful request', async () => {
      const args = {
        userId: 'user-1',
        question: 'what model should I use?',
        initiatorId: 'superclaw',
        task: 'setup system',
      };

      const result = await seekClarification.execute(args);

      expect(result).toContain('TASK_PAUSED');
      expect(result).toContain('sent a clarification request to **superclaw**');

      expect(emitEvent).toHaveBeenCalledWith(
        'superclaw',
        'clarification_request',
        expect.objectContaining({
          question: 'what model should I use?',
          originalTask: 'setup system',
        })
      );
    });
  });

  describe('provideClarification', () => {
    it('should emit CONTINUATION_TASK event', async () => {
      const args = {
        userId: 'user-1',
        agentId: 'coder',
        answer: 'Yes',
        originalTask: 'Task 1',
      };

      const result = await provideClarification.execute(args);
      expect(result).toContain('Clarification provided to coder');
      expect(emitEvent).toHaveBeenCalledWith(
        'agent.tool',
        'continuation_task',
        expect.objectContaining({
          agentId: 'coder',
          isContinuation: true,
        })
      );
    });
  });
});
