import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DISPATCH_TASK, SEEK_CLARIFICATION } from './knowledge-agent';
import { emitEvent } from '../lib/utils/bus';

// Mock dependencies
vi.mock('../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({ enabled: true }),
  },
}));

vi.mock('../lib/tracer', () => ({
  ClawTracer: vi.fn().mockImplementation(function () {
    return {
      getChildTracer: vi.fn().mockReturnValue({
        getTraceId: () => 'child-trace-123',
        getNodeId: () => 'child-node-123',
        getParentId: () => 'parent-node-123',
      }),
    };
  }),
}));

describe('Knowledge Agent Tools (Delegation Signals)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DISPATCH_TASK', () => {
    it('should return TASK_PAUSED signal upon successful dispatch', async () => {
      const args = {
        agentId: 'coder',
        userId: 'user-1',
        task: 'build a feature',
        sessionId: 'session-1',
      };

      const result = await DISPATCH_TASK.execute(args);

      expect(result).toContain('TASK_PAUSED');
      expect(result).toContain('Task successfully dispatched to coder agent');

      // Verify event emission
      expect(emitEvent).toHaveBeenCalledWith(
        'main.agent',
        'coder_task',
        expect.objectContaining({
          userId: 'user-1',
          task: 'build a feature',
          sessionId: 'session-1',
          traceId: 'child-trace-123',
        })
      );
    });

    it('should handle missing agent config gracefully', async () => {
      const { AgentRegistry } = await import('../lib/registry');
      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValueOnce(null);

      const result = await DISPATCH_TASK.execute({ agentId: 'unknown', userId: 'u1', task: 't' });
      expect(result).toContain("FAILED: Agent 'unknown' is not registered");
    });
  });

  describe('SEEK_CLARIFICATION', () => {
    it('should return TASK_PAUSED signal upon successful request', async () => {
      const args = {
        userId: 'user-1',
        question: 'what model should I use?',
        initiatorId: 'main.agent',
        task: 'setup system',
      };

      const result = await SEEK_CLARIFICATION.execute(args);

      expect(result).toContain('TASK_PAUSED');
      expect(result).toContain('Clarification request sent to main.agent');

      expect(emitEvent).toHaveBeenCalledWith(
        'main.agent',
        'clarification_request',
        expect.objectContaining({
          question: 'what model should I use?',
          originalTask: 'setup system',
        })
      );
    });
  });
});
