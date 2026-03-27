import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CREATE_COLLABORATION,
  JOIN_COLLABORATION,
  GET_COLLABORATION_CONTEXT,
  WRITE_TO_COLLABORATION,
  LIST_MY_COLLABORATIONS,
} from './collaboration';
import { getAgentContext } from '../lib/utils/agent-helpers';

// Mock agent-helpers
vi.mock('../lib/utils/agent-helpers', () => ({
  getAgentContext: vi.fn(),
}));

describe('Collaboration Tools', () => {
  let mockMemory: any;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      createCollaboration: vi.fn(),
      getCollaboration: vi.fn(),
      checkCollaborationAccess: vi.fn(),
      getHistory: vi.fn(),
      addMessage: vi.fn(),
      listCollaborationsForParticipant: vi.fn(),
    };
    mockContext = {
      agentId: 'test-agent',
      memory: mockMemory,
    };
    (getAgentContext as any).mockResolvedValue(mockContext);
  });

  it('CREATE_COLLABORATION should call memory.createCollaboration', async () => {
    const collab = {
      collaborationId: 'c1',
      sessionId: 's1',
      syntheticUserId: 'u1',
      name: 'Test',
      participants: [],
    };
    mockMemory.createCollaboration.mockResolvedValue(collab);

    const result = await CREATE_COLLABORATION.execute({ name: 'Test', agentId: 'test-agent' });
    const parsed = JSON.parse(result as string);

    expect(parsed.success).toBe(true);
    expect(parsed.collaborationId).toBe('c1');
    expect(mockMemory.createCollaboration).toHaveBeenCalledWith(
      'test-agent',
      'agent',
      expect.objectContaining({ name: 'Test' })
    );
  });

  it('JOIN_COLLABORATION should verify participation', async () => {
    const collab = {
      collaborationId: 'c1',
      participants: [{ id: 'test-agent', type: 'agent' }],
    };
    mockMemory.getCollaboration.mockResolvedValue(collab);

    const result = await JOIN_COLLABORATION.execute({
      collaborationId: 'c1',
      agentId: 'test-agent',
    });
    const parsed = JSON.parse(result as string);

    expect(parsed.success).toBe(true);
    expect(mockMemory.getCollaboration).toHaveBeenCalledWith('c1');
  });

  it('JOIN_COLLABORATION should fail if not a participant', async () => {
    const collab = {
      collaborationId: 'c1',
      participants: [{ id: 'other-agent', type: 'agent' }],
    };
    mockMemory.getCollaboration.mockResolvedValue(collab);

    const result = await JOIN_COLLABORATION.execute({
      collaborationId: 'c1',
      agentId: 'test-agent',
    });
    const parsed = JSON.parse(result as string);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Not a participant');
  });

  it('GET_COLLABORATION_CONTEXT should return history', async () => {
    const collab = { syntheticUserId: 'u1', sessionId: 's1' };
    mockMemory.getCollaboration.mockResolvedValue(collab);
    mockMemory.checkCollaborationAccess.mockResolvedValue(true);
    mockMemory.getHistory.mockResolvedValue([{ role: 'user', content: 'hi', timestamp: 123 }]);

    const result = await GET_COLLABORATION_CONTEXT.execute({ collaborationId: 'c1' });
    const parsed = JSON.parse(result as string);

    expect(parsed.success).toBe(true);
    expect(parsed.messages).toHaveLength(1);
    expect(mockMemory.getHistory).toHaveBeenCalledWith('u1');
  });

  it('WRITE_TO_COLLABORATION should add message', async () => {
    const collab = { syntheticUserId: 'u1' };
    mockMemory.getCollaboration.mockResolvedValue(collab);
    mockMemory.checkCollaborationAccess.mockResolvedValue(true);

    const result = await WRITE_TO_COLLABORATION.execute({
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

  it('LIST_MY_COLLABORATIONS should list collaborations', async () => {
    mockMemory.listCollaborationsForParticipant.mockResolvedValue([{ collaborationId: 'c1' }]);

    const result = await LIST_MY_COLLABORATIONS.execute({ agentId: 'test-agent' });
    const parsed = JSON.parse(result as string);

    expect(parsed.success).toBe(true);
    expect(parsed.collaborations).toHaveLength(1);
    expect(mockMemory.listCollaborationsForParticipant).toHaveBeenCalledWith('test-agent', 'agent');
  });
});
