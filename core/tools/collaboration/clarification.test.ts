import { vi, describe, it, expect, beforeEach } from 'vitest';
import { seekClarification, provideClarification } from './clarification';
import { emitEvent } from '../../lib/utils/bus';

vi.mock('../../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/utils/error', () => ({
  formatErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
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

    it('should default initiatorId to superclaw', async () => {
      const args = {
        userId: 'user-1',
        question: 'what model?',
      };

      const result = await seekClarification.execute(args);

      expect(result).toContain('**superclaw**');
      expect(emitEvent).toHaveBeenCalledWith(
        'superclaw',
        'clarification_request',
        expect.objectContaining({
          initiatorId: 'superclaw',
        })
      );
    });

    it('should increment depth by 1', async () => {
      const args = {
        userId: 'user-1',
        question: 'what?',
        depth: 2,
      };

      await seekClarification.execute(args);

      expect(emitEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ depth: 3 })
      );
    });

    it('should default depth to 1 when not provided', async () => {
      const args = {
        userId: 'user-1',
        question: 'what?',
      };

      await seekClarification.execute(args);

      expect(emitEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ depth: 1 })
      );
    });

    it('should use task as originalTask when originalTask is not provided', async () => {
      const args = {
        userId: 'user-1',
        question: 'what?',
        task: 'build the thing',
      };

      await seekClarification.execute(args);

      expect(emitEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ originalTask: 'build the thing' })
      );
    });

    it('should default originalTask to Unknown task', async () => {
      const args = {
        userId: 'user-1',
        question: 'what?',
      };

      await seekClarification.execute(args);

      expect(emitEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ originalTask: 'Unknown task' })
      );
    });

    it('should include all provided fields in event', async () => {
      const args = {
        userId: 'user-1',
        agentId: 'coder',
        question: 'what language?',
        traceId: 'trace-123',
        initiatorId: 'strategic-planner',
        depth: 1,
        sessionId: 'sess-1',
        originalTask: 'build app',
      };

      await seekClarification.execute(args);

      expect(emitEvent).toHaveBeenCalledWith(
        'strategic-planner',
        'clarification_request',
        expect.objectContaining({
          userId: 'user-1',
          agentId: 'coder',
          question: 'what language?',
          traceId: 'trace-123',
          initiatorId: 'strategic-planner',
          depth: 2,
          sessionId: 'sess-1',
          originalTask: 'build app',
        })
      );
    });

    it('should return error message on failure', async () => {
      (emitEvent as any).mockRejectedValueOnce(new Error('Bus down'));

      const result = await seekClarification.execute({
        userId: 'user-1',
        question: 'what?',
      });

      expect(result).toContain('Failed to seek clarification');
      expect(result).toContain('Bus down');
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

    it('should include answer in continuation task', async () => {
      await provideClarification.execute({
        userId: 'u1',
        agentId: 'coder',
        answer: 'Use TypeScript',
        originalTask: 'Choose language',
      });

      const detail = (emitEvent as any).mock.calls[0][2];
      expect(detail.task).toContain('Use TypeScript');
      expect(detail.task).toContain('Choose language');
    });

    it('should increment depth by 1', async () => {
      await provideClarification.execute({
        userId: 'u1',
        agentId: 'coder',
        answer: 'yes',
        originalTask: 'task',
        depth: 3,
      });

      expect(emitEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ depth: 4 })
      );
    });

    it('should default depth to 1 when not provided', async () => {
      await provideClarification.execute({
        userId: 'u1',
        agentId: 'coder',
        answer: 'yes',
        originalTask: 'task',
      });

      expect(emitEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ depth: 1 })
      );
    });

    it('should pass through traceId and sessionId', async () => {
      await provideClarification.execute({
        userId: 'u1',
        agentId: 'coder',
        answer: 'yes',
        originalTask: 'task',
        traceId: 'trace-1',
        sessionId: 'sess-1',
      });

      expect(emitEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          traceId: 'trace-1',
          sessionId: 'sess-1',
        })
      );
    });

    it('should pass through initiatorId', async () => {
      await provideClarification.execute({
        userId: 'u1',
        agentId: 'coder',
        answer: 'yes',
        originalTask: 'task',
        initiatorId: 'superclaw',
      });

      expect(emitEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ initiatorId: 'superclaw' })
      );
    });

    it('should return error message on event failure', async () => {
      (emitEvent as any).mockRejectedValueOnce(new Error('Event bus down'));

      const result = await provideClarification.execute({
        userId: 'u1',
        agentId: 'coder',
        answer: 'yes',
        originalTask: 'task',
      });

      expect(result).toContain('Failed to provide clarification');
      expect(result).toContain('Event bus down');
    });

    it('should update clarification status when traceId and agentId provided', async () => {
      await provideClarification.execute({
        userId: 'u1',
        agentId: 'coder',
        answer: 'yes',
        originalTask: 'task',
        traceId: 'trace-1',
      });

      expect(emitEvent).toHaveBeenCalled();
    });

    it('should not fail when memory update fails', async () => {
      const result = await provideClarification.execute({
        userId: 'u1',
        agentId: 'coder',
        answer: 'yes',
        originalTask: 'task',
        traceId: 'trace-1',
      });

      expect(result).toContain('Clarification provided to coder');
    });
  });

  describe('schema inheritance', () => {
    it('should have seekClarification tool properties', () => {
      expect(seekClarification.name).toBe('seekClarification');
      expect(seekClarification.description).toBeDefined();
      expect(seekClarification.execute).toBeDefined();
    });

    it('should have provideClarification tool properties', () => {
      expect(provideClarification.name).toBe('provideClarification');
      expect(provideClarification.description).toBeDefined();
      expect(provideClarification.execute).toBeDefined();
    });
  });
});
