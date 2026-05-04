import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createCollaboration,
  joinCollaboration,
  getCollaborationContext,
  writeToCollaboration,
  closeCollaboration,
  listMyCollaborations,
} from './collaboration';
import { getAgentContext } from '../../lib/utils/agent-helpers';

vi.mock('../../lib/utils/agent-helpers');

vi.mock('../../lib/utils/trace-helper', () => ({
  addTraceStep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/utils/typed-emit', () => ({
  emitTypedEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/outbound', () => ({
  sendOutboundMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/types/llm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    MessageRole: { USER: 'user', ASSISTANT: 'assistant' },
  };
});

vi.mock('../../lib/types/agent', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    AgentRole: { FACILITATOR: 'facilitator' },
  };
});

vi.mock('../../lib/types/tool', () => ({
  ITool: {},
  ToolType: { FUNCTION: 'function' },
}));

describe('Collaboration Tools', () => {
  let mockMemory: Record<string, ReturnType<typeof vi.fn>>;
  let mockContext: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      createCollaboration: vi.fn(),
      getCollaboration: vi.fn(),
      checkCollaborationAccess: vi.fn(),
      getHistory: vi.fn(),
      addMessage: vi.fn(),
      listCollaborationsForParticipant: vi.fn(),
      closeCollaboration: vi.fn(),
    };
    mockContext = {
      agentId: 'test-agent',
      memory: mockMemory,
    };
    vi.mocked(getAgentContext).mockResolvedValue(mockContext as any);
  });

  describe('createCollaboration', () => {
    it('should call memory.createCollaboration', async () => {
      const collab = {
        collaborationId: 'c1',
        sessionId: 's1',
        syntheticUserId: 'u1',
        name: 'Test',
        participants: [],
      };
      mockMemory.createCollaboration.mockResolvedValue(collab);

      const result = await createCollaboration.execute({ name: 'Test', agentId: 'test-agent' });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.collaborationId).toBe('c1');
      expect(mockMemory.createCollaboration).toHaveBeenCalledWith(
        'test-agent',
        'agent',
        expect.objectContaining({ name: 'Test' })
      );
    });

    it('should auto-add facilitator as participant', async () => {
      const collab = {
        collaborationId: 'c1',
        sessionId: 's1',
        syntheticUserId: 'u1',
        name: 'Test',
        participants: [],
      };
      mockMemory.createCollaboration.mockResolvedValue(collab);

      await createCollaboration.execute({ name: 'Test', agentId: 'test-agent' });

      const callArgs = mockMemory.createCollaboration.mock.calls[0][2];
      expect(callArgs.initialParticipants).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'facilitator', role: 'editor' })])
      );
    });

    it('should not duplicate facilitator if already in participants', async () => {
      const collab = {
        collaborationId: 'c1',
        sessionId: 's1',
        syntheticUserId: 'u1',
        name: 'Test',
        participants: [{ type: 'agent', id: 'facilitator', role: 'editor' }],
      };
      mockMemory.createCollaboration.mockResolvedValue(collab);

      await createCollaboration.execute({
        name: 'Test',
        agentId: 'test-agent',
        participants: [{ type: 'agent', id: 'facilitator', role: 'editor' }],
      });

      const callArgs = mockMemory.createCollaboration.mock.calls[0][2];
      const facilitatorCount = callArgs.initialParticipants.filter(
        (p: any) => p.id === 'facilitator'
      ).length;
      expect(facilitatorCount).toBe(1);
    });

    it('should include human and agent counts in response', async () => {
      mockMemory.createCollaboration.mockResolvedValue({
        collaborationId: 'c2',
        sessionId: 's2',
        syntheticUserId: 'u2',
        name: 'Multi-party',
        participants: [
          { type: 'human', id: 'user-1', role: 'editor' },
          { type: 'agent', id: 'coder', role: 'editor' },
          { type: 'agent', id: 'facilitator', role: 'editor' },
        ],
      });

      const result = await createCollaboration.execute({ name: 'Multi-party' });
      const parsed = JSON.parse(result as string);

      expect(parsed.message).toContain('1 humans');
      expect(parsed.message).toContain('2 agents');
    });

    it('should use default agentId when not provided', async () => {
      mockMemory.createCollaboration.mockResolvedValue({
        collaborationId: 'c3',
        sessionId: 's3',
        syntheticUserId: 'u3',
        name: 'No agent',
        participants: [],
      });

      await createCollaboration.execute({ name: 'No agent' });

      expect(mockMemory.createCollaboration).toHaveBeenCalledWith(
        'unknown',
        'agent',
        expect.any(Object)
      );
    });

    it('should handle traceId by adding trace step', async () => {
      const { addTraceStep } = await import('../../lib/utils/trace-helper');
      mockMemory.createCollaboration.mockResolvedValue({
        collaborationId: 'c4',
        sessionId: 's4',
        syntheticUserId: 'u4',
        name: 'Traced',
        participants: [],
      });

      await createCollaboration.execute({ name: 'Traced', traceId: 'trace-1' });

      expect(addTraceStep).toHaveBeenCalledWith(
        'trace-1',
        'root',
        expect.objectContaining({ type: 'collaboration_started' })
      );
    });

    it('should pass optional fields to createCollaboration', async () => {
      mockMemory.createCollaboration.mockResolvedValue({
        collaborationId: 'c5',
        sessionId: 's5',
        syntheticUserId: 'u5',
        name: 'Opts',
        participants: [],
      });

      await createCollaboration.execute({
        name: 'Opts',
        description: 'Test collab',
        ttlDays: 7,
        tags: ['test'],
        workspaceId: 'ws-1',
      });

      expect(mockMemory.createCollaboration).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          description: 'Test collab',
          ttlDays: 7,
          tags: ['test'],
          workspaceId: 'ws-1',
        })
      );
    });
  });

  describe('joinCollaboration', () => {
    it('should verify participation and return collaboration details', async () => {
      const collab = {
        collaborationId: 'c1',
        sessionId: 's1',
        syntheticUserId: 'u1',
        name: 'Test',
        participants: [{ id: 'test-agent', type: 'agent' }],
      };
      mockMemory.getCollaboration.mockResolvedValue(collab);

      const result = await joinCollaboration.execute({
        collaborationId: 'c1',
        agentId: 'test-agent',
      });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.collaborationId).toBe('c1');
      expect(mockMemory.getCollaboration).toHaveBeenCalledWith('c1');
    });

    it('should fail if not a participant', async () => {
      mockMemory.getCollaboration.mockResolvedValue({
        collaborationId: 'c1',
        participants: [{ id: 'other-agent', type: 'agent' }],
      });

      const result = await joinCollaboration.execute({
        collaborationId: 'c1',
        agentId: 'test-agent',
      });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Not a participant');
    });

    it('should fail if collaboration not found', async () => {
      mockMemory.getCollaboration.mockResolvedValue(null);

      const result = await joinCollaboration.execute({
        collaborationId: 'missing',
        agentId: 'test-agent',
      });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Collaboration not found');
    });

    it('should fail if participant type is human not agent', async () => {
      mockMemory.getCollaboration.mockResolvedValue({
        collaborationId: 'c1',
        participants: [{ id: 'test-agent', type: 'human' }],
      });

      const result = await joinCollaboration.execute({
        collaborationId: 'c1',
        agentId: 'test-agent',
      });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Not a participant');
    });
  });

  describe('getCollaborationContext', () => {
    it('should return history', async () => {
      const collab = { syntheticUserId: 'u1', sessionId: 's1' };
      mockMemory.getCollaboration.mockResolvedValue(collab);
      mockMemory.checkCollaborationAccess.mockResolvedValue(true);
      mockMemory.getHistory.mockResolvedValue([{ role: 'user', content: 'hi', timestamp: 123 }]);

      const result = await getCollaborationContext.execute({ collaborationId: 'c1' });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.messages).toHaveLength(1);
      expect(mockMemory.getHistory).toHaveBeenCalledWith('u1');
    });

    it('should fail if collaboration not found', async () => {
      mockMemory.getCollaboration.mockResolvedValue(null);

      const result = await getCollaborationContext.execute({ collaborationId: 'missing' });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Collaboration not found');
    });

    it('should fail if access denied', async () => {
      mockMemory.getCollaboration.mockResolvedValue({ syntheticUserId: 'u1' });
      mockMemory.checkCollaborationAccess.mockResolvedValue(false);

      const result = await getCollaborationContext.execute({
        collaborationId: 'c1',
        agentId: 'unauthorized-agent',
      });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Access denied');
    });

    it('should respect limit parameter', async () => {
      mockMemory.getCollaboration.mockResolvedValue({ syntheticUserId: 'u1', sessionId: 's1' });
      mockMemory.checkCollaborationAccess.mockResolvedValue(true);
      mockMemory.getHistory.mockResolvedValue(
        Array.from({ length: 100 }, (_, i) => ({ role: 'assistant', content: `msg${i}` }))
      );

      const result = await getCollaborationContext.execute({
        collaborationId: 'c1',
        limit: 10,
      });
      const parsed = JSON.parse(result as string);

      expect(parsed.messages).toHaveLength(10);
      expect(parsed.messageCount).toBe(10);
    });

    it('should default limit to 50', async () => {
      mockMemory.getCollaboration.mockResolvedValue({ syntheticUserId: 'u1', sessionId: 's1' });
      mockMemory.checkCollaborationAccess.mockResolvedValue(true);
      mockMemory.getHistory.mockResolvedValue(
        Array.from({ length: 200 }, (_, i) => ({ role: 'user', content: `m${i}` }))
      );

      const result = await getCollaborationContext.execute({ collaborationId: 'c1' });
      const parsed = JSON.parse(result as string);

      expect(parsed.messages).toHaveLength(50);
    });
  });

  describe('writeToCollaboration', () => {
    it('should add message and return success', async () => {
      const collab = { syntheticUserId: 'u1' };
      mockMemory.getCollaboration.mockResolvedValue(collab);
      mockMemory.checkCollaborationAccess.mockResolvedValue(true);

      const result = await writeToCollaboration.execute({
        collaborationId: 'c1',
        content: 'hello',
      });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(mockMemory.addMessage).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ content: 'hello' })
      );
    });

    it('should fail if collaboration not found', async () => {
      mockMemory.getCollaboration.mockResolvedValue(null);

      const result = await writeToCollaboration.execute({
        collaborationId: 'missing',
        content: 'hello',
      });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Collaboration not found');
    });

    it('should fail if access denied or insufficient permissions', async () => {
      mockMemory.getCollaboration.mockResolvedValue({ syntheticUserId: 'u1' });
      mockMemory.checkCollaborationAccess.mockResolvedValue(false);

      const result = await writeToCollaboration.execute({
        collaborationId: 'c1',
        content: 'hello',
      });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Access denied or insufficient permissions');
    });

    it('should use user role when specified', async () => {
      mockMemory.getCollaboration.mockResolvedValue({ syntheticUserId: 'u1' });
      mockMemory.checkCollaborationAccess.mockResolvedValue(true);

      await writeToCollaboration.execute({
        collaborationId: 'c1',
        content: 'user msg',
        role: 'user',
      });

      expect(mockMemory.addMessage).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ role: 'user', content: 'user msg' })
      );
    });

    it('should handle traceId by adding trace step', async () => {
      const { addTraceStep } = await import('../../lib/utils/trace-helper');
      mockMemory.getCollaboration.mockResolvedValue({
        syntheticUserId: 'u1',
        owner: { id: 'owner-1' },
      });
      mockMemory.checkCollaborationAccess.mockResolvedValue(true);

      await writeToCollaboration.execute({
        collaborationId: 'c1',
        content: 'traced message',
        traceId: 'trace-1',
      });

      expect(addTraceStep).toHaveBeenCalledWith(
        'trace-1',
        'root',
        expect.objectContaining({
          content: expect.objectContaining({
            collaborationId: 'c1',
          }),
        })
      );
    });

    it('should truncate content in trace step to 200 chars', async () => {
      const { addTraceStep } = await import('../../lib/utils/trace-helper');
      mockMemory.getCollaboration.mockResolvedValue({
        syntheticUserId: 'u1',
        owner: { id: 'owner-1' },
      });
      mockMemory.checkCollaborationAccess.mockResolvedValue(true);

      const longContent = 'x'.repeat(500);
      await writeToCollaboration.execute({
        collaborationId: 'c1',
        content: longContent,
        traceId: 'trace-1',
      });

      expect(addTraceStep).toHaveBeenCalledWith(
        'trace-1',
        'root',
        expect.objectContaining({
          content: expect.objectContaining({
            content: 'x'.repeat(200),
          }),
        })
      );
    });
  });

  describe('closeCollaboration', () => {
    it('should close collaboration successfully', async () => {
      mockMemory.closeCollaboration.mockResolvedValue(undefined);

      const result = await closeCollaboration.execute({
        collaborationId: 'c1',
        agentId: 'test-agent',
      });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.message).toContain('closed successfully');
      expect(mockMemory.closeCollaboration).toHaveBeenCalledWith('c1', 'test-agent', 'agent');
    });

    it('should handle traceId by adding trace step', async () => {
      const { addTraceStep } = await import('../../lib/utils/trace-helper');
      mockMemory.closeCollaboration.mockResolvedValue(undefined);

      await closeCollaboration.execute({
        collaborationId: 'c1',
        traceId: 'trace-1',
      });

      expect(addTraceStep).toHaveBeenCalledWith(
        'trace-1',
        'root',
        expect.objectContaining({
          type: 'collaboration_completed',
          content: expect.objectContaining({
            collaborationId: 'c1',
            status: 'closed',
          }),
        })
      );
    });

    it('should return error when close fails', async () => {
      mockMemory.closeCollaboration.mockRejectedValue(new Error('Not authorized'));

      const result = await closeCollaboration.execute({
        collaborationId: 'c1',
      });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Not authorized');
    });

    it('should handle non-Error exceptions in close', async () => {
      mockMemory.closeCollaboration.mockRejectedValue('string error');

      const result = await closeCollaboration.execute({ collaborationId: 'c1' });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('string error');
    });

    it('should use default agentId when not provided', async () => {
      mockMemory.closeCollaboration.mockResolvedValue(undefined);

      await closeCollaboration.execute({ collaborationId: 'c1' });

      expect(mockMemory.closeCollaboration).toHaveBeenCalledWith('c1', 'unknown', 'agent');
    });
  });

  describe('listMyCollaborations', () => {
    it('should list collaborations', async () => {
      mockMemory.listCollaborationsForParticipant.mockResolvedValue([{ collaborationId: 'c1' }]);

      const result = await listMyCollaborations.execute({ agentId: 'test-agent' });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.collaborations).toHaveLength(1);
      expect(mockMemory.listCollaborationsForParticipant).toHaveBeenCalledWith(
        'test-agent',
        'agent'
      );
    });

    it('should return empty list when no collaborations', async () => {
      mockMemory.listCollaborationsForParticipant.mockResolvedValue([]);

      const result = await listMyCollaborations.execute({ agentId: 'test-agent' });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.count).toBe(0);
      expect(parsed.collaborations).toEqual([]);
    });

    it('should use default agentId when not provided', async () => {
      mockMemory.listCollaborationsForParticipant.mockResolvedValue([]);

      await listMyCollaborations.execute({});

      expect(mockMemory.listCollaborationsForParticipant).toHaveBeenCalledWith('unknown', 'agent');
    });
  });
});
