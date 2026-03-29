import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createCollaboration,
  joinCollaboration,
  getCollaborationContext,
  writeToCollaboration,
  listMyCollaborations,
} from './collaboration';
import { getAgentContext } from '../../lib/utils/agent-helpers';

// Mock agent-helpers
vi.mock('../../lib/utils/agent-helpers');

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
    vi.mocked(getAgentContext).mockResolvedValue(mockContext);
  });

  it('createCollaboration should call memory.createCollaboration', async () => {
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

  it('joinCollaboration should verify participation', async () => {
    const collab = {
      collaborationId: 'c1',
      participants: [{ id: 'test-agent', type: 'agent' }],
    };
    mockMemory.getCollaboration.mockResolvedValue(collab);

    const result = await joinCollaboration.execute({
      collaborationId: 'c1',
      agentId: 'test-agent',
    });
    const parsed = JSON.parse(result as string);

    expect(parsed.success).toBe(true);
    expect(mockMemory.getCollaboration).toHaveBeenCalledWith('c1');
  });

  it('joinCollaboration should fail if not a participant', async () => {
    const collab = {
      collaborationId: 'c1',
      participants: [{ id: 'other-agent', type: 'agent' }],
    };
    mockMemory.getCollaboration.mockResolvedValue(collab);

    const result = await joinCollaboration.execute({
      collaborationId: 'c1',
      agentId: 'test-agent',
    });
    const parsed = JSON.parse(result as string);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Not a participant');
  });

  it('getCollaborationContext should return history', async () => {
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

  it('writeToCollaboration should add message', async () => {
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

  it('listMyCollaborations should list collaborations', async () => {
    mockMemory.listCollaborationsForParticipant.mockResolvedValue([{ collaborationId: 'c1' }]);

    const result = await listMyCollaborations.execute({ agentId: 'test-agent' });
    const parsed = JSON.parse(result as string);

    expect(parsed.success).toBe(true);
    expect(parsed.collaborations).toHaveLength(1);
    expect(mockMemory.listCollaborationsForParticipant).toHaveBeenCalledWith('test-agent', 'agent');
  });
});
