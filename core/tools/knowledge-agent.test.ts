import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DISPATCH_TASK, SEEK_CLARIFICATION, LIST_AGENTS } from './knowledge-agent';
import { emitEvent } from '../lib/utils/bus';

// Mock dependencies
vi.mock('../lib/utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn().mockResolvedValue({ enabled: true }),
    getAllConfigs: vi.fn().mockResolvedValue({}),
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

  describe('LIST_AGENTS', () => {
    it('should list enabled agents but exclude main', async () => {
      const { AgentRegistry } = await import('../lib/registry');
      vi.mocked(AgentRegistry.getAllConfigs).mockResolvedValueOnce({
        superclaw: { id: 'superclaw', name: 'SuperClaw', enabled: true, description: 'Orchestrator' } as any,
        coder: { id: 'coder', name: 'Coder', enabled: true, description: 'Writes code' } as any,
        disabled: { id: 'bad', name: 'Bad', enabled: false, description: 'Off' } as any,
      });

      const result = await LIST_AGENTS.execute();

      expect(result).toContain('- [coder] Coder: Writes code');
      expect(result).not.toContain('SuperClaw');
      expect(result).not.toContain('[superclaw]');
      expect(result).not.toContain('Bad');
    });

    it('should return helpful message when no agents available', async () => {
      const { AgentRegistry } = await import('../lib/registry');
      vi.mocked(AgentRegistry.getAllConfigs).mockResolvedValueOnce({});

      const result = await LIST_AGENTS.execute();
      expect(result).toBe('No enabled agents found in the registry.');
    });
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
      expect(result).toContain('successfully dispatched this task to the **coder** agent');

      // Verify event emission
      expect(emitEvent).toHaveBeenCalledWith(
        'superclaw',
        'coder_task',
        expect.objectContaining({
          userId: 'user-1',
          task: 'build a feature',
          sessionId: 'session-1',
          traceId: 'child-trace-123',
        })
      );
    });

    it('should prevent dispatching to the main agent', async () => {
      const args = {
        agentId: 'superclaw',
        userId: 'user-1',
        task: 'build a feature',
      };

      const result = await DISPATCH_TASK.execute(args);

      expect(result).toContain("FAILED: Cannot dispatch tasks to the 'superclaw' agent");
      expect(emitEvent).not.toHaveBeenCalled();
    });

    it('should handle missing agent config gracefully', async () => {
      const { AgentRegistry } = await import('../lib/registry');
      vi.mocked(AgentRegistry.getAgentConfig).mockResolvedValueOnce(undefined);

      const result = await DISPATCH_TASK.execute({ agentId: 'unknown', userId: 'u1', task: 't' });
      expect(result).toContain("FAILED: Agent 'unknown' is not registered");
    });
  });

  describe('SEEK_CLARIFICATION', () => {
    it('should return TASK_PAUSED signal upon successful request', async () => {
      const args = {
        userId: 'user-1',
        question: 'what model should I use?',
        initiatorId: 'superclaw.agent',
        task: 'setup system',
      };

      const result = await SEEK_CLARIFICATION.execute(args);

      expect(result).toContain('TASK_PAUSED');
      expect(result).toContain('sent a clarification request to **superclaw.agent**');

      expect(emitEvent).toHaveBeenCalledWith(
        'superclaw.agent',
        'clarification_request',
        expect.objectContaining({
          question: 'what model should I use?',
          originalTask: 'setup system',
        })
      );
    });
  });
});
